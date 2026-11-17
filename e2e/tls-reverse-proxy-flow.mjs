// NEXUS — F06-b: TLS termination through a REAL nginx reverse proxy (docs/deploy/nginx-nexus-tls.conf.template), real Chromium, real built backend, SIMULATED local model.
// Proves (measured, not assumed): CONTROL — the plain-HTTP page on a non-"potentially trustworthy" host name (nexus.test, mapped to 127.0.0.1 inside Chromium) is NOT a secure context
// (the previously BLOCKED LAN case, docs/DEPLOYMENT-LAN.md §4); through nginx over HTTPS the app boots with WebCrypto + Service Worker, chat works end-to-end, HSTS is sent, the backend
// stays loopback-bound, and the proxy REPLACES a client-supplied X-Forwarded-For.
// LIMITS (UNVERIFIED, disclosed): (a) the HTTPS leg is addressed as https://127.0.0.1 — in this sandbox Chromium's TLS handshake to ANY host NAME (SNI) was reset before reaching nginx
// (net-log: ECONNRESET during handshake; cause not determined), and the sandbox egress policy blocks its own non-loopback address; a loopback origin is secure by definition, so the
// "HTTPS is a secure context on a LAN name" claim rests on the browser rule, not on this run; (b) no trusted CA certificate and no real second device are exercised.
// Requires nginx + openssl on PATH; SKIPPED (exit 0, prints SKIPPED) otherwise.
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };
const has = (cmd) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const NAME = 'nexus.test'; const IP = '127.0.0.1';
const NGINX = spawnSync('sh', ['-c', 'command -v nginx || ls /usr/sbin/nginx 2>/dev/null']).stdout.toString().trim().split('\n')[0];
if (!NGINX || !has('openssl')) { console.log(`SKIPPED — nginx=${!!NGINX} openssl=${has('openssl')} (this check needs both)`); process.exit(0); }

const RUN = mkdtempSync(path.join(tmpdir(), 'nexus-tls-')); mkdirSync(path.join(RUN, 'tmp'), { recursive: true });
const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=nexus.test', '-addext', `subjectAltName=IP:${IP},DNS:${NAME}`, '-keyout', path.join(RUN, 'k.pem'), '-out', path.join(RUN, 'c.pem')], { stdio: 'pipe' });
check('self-signed test certificate generated (openssl)', gen.status === 0, gen.stderr?.toString().slice(0, 100));

// simulated local model (Ollama protocol) + XFF echo upstream
let localHits = 0;
const fake = createServer(async (req, res) => { for await (const _ of req); if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); } localHits++; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'رد محاكى عبر TLS.' }, done: true, prompt_eval_count: 3, eval_count: 9 })); });
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const echo = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ xff: req.headers['x-forwarded-for'] || null, proto: req.headers['x-forwarded-proto'] || null })); });
await new Promise((r) => echo.listen(0, '127.0.0.1', r));

const base = 19000 + Math.floor(Math.random() * 800); const UI = base, API = base + 1, TLS = base + 2;
const conf = readFileSync(path.join(ROOT, 'docs/deploy/nginx-nexus-tls.conf.template'), 'utf8')
  .replaceAll('@RUN_DIR@', RUN).replaceAll('@LISTEN_IP@', IP).replaceAll('@TLS_PORT@', String(TLS)).replaceAll('@CERT@', path.join(RUN, 'c.pem')).replaceAll('@KEY@', path.join(RUN, 'k.pem'))
  .replaceAll('@API_PORT@', String(API)).replaceAll('@UI_PORT@', String(UI))
  .replace('@TEST_LOCATIONS@', `location = /__xff_echo { proxy_pass http://127.0.0.1:${echo.address().port}; }`);
const confPath = path.join(RUN, 'nginx.conf'); writeFileSync(confPath, conf);
const t = spawnSync(NGINX, ['-t', '-c', confPath, '-e', path.join(RUN, 'error.log')], { stdio: 'pipe' });
check('nginx -t accepts the documented template (after placeholder substitution)', t.status === 0, (t.stderr?.toString() || '').trim().split('\n').slice(-1)[0]);

const dbf = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-tlsdb-')), 'n.db');
const run = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-run.mjs')], { env: { ...process.env, NEXUS_UI_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_DB_PATH: dbf, NEXUS_LOG_LEVEL: 'warn', NEXUS_TRUST_PROXY: '127.0.0.1', NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${fake.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; run.stdout.on('data', (d) => (out += d)); run.stderr.on('data', (d) => (out += d));
let key = null; for (let i = 0; i < 60 && !key; i++) { await sleep(250); key = /Gateway key:\s+(\S+)/.exec(out)?.[1] || null; }
let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${API}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher + backend up on 127.0.0.1 with NEXUS_TRUST_PROXY=127.0.0.1', !!key && up, key ? 'key printed' : out.slice(0, 200));
const ng = spawn(NGINX, ['-c', confPath, '-e', path.join(RUN, 'error.log'), '-g', 'daemon off;'], { stdio: 'ignore' });
let ngUp = false; for (let i = 0; i < 40 && !ngUp; i++) { await sleep(250); ngUp = await new Promise((r) => { import('node:net').then(({ connect }) => { const s = connect(TLS, IP); s.on('connect', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); }); }); }
check(`nginx is listening on ${IP}:${TLS} (TLS)`, ngUp);

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${NAME} 127.0.0.1`, "--no-proxy-server"] /* hermetic: never route this loopback test through an ambient HTTPS_PROXY */ });
const errors = [];
try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
  // CONTROL (the documented BLOCKED case): same page over plain HTTP on the same non-trustworthy host name
  const cpage = await ctx.newPage();
  await cpage.goto(`http://${NAME}:${UI}/NEXUS.html`, { waitUntil: 'load' });
  const csec = await cpage.evaluate(() => ({ secure: window.isSecureContext, subtle: !!(crypto && crypto.subtle), sw: 'serviceWorker' in navigator }));
  check('CONTROL: plain http://nexus.test is NOT a secure context (no WebCrypto/Service Worker) — reproduces the BLOCKED LAN case', !csec.secure && !csec.subtle && !csec.sw, JSON.stringify(csec));
  await cpage.close();
  const ORIGIN = `https://${IP}:${TLS}`;
  await page.goto(`${ORIGIN}/NEXUS.html`, { waitUntil: 'load' });
  const sec = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: !!(crypto && crypto.subtle), sw: 'serviceWorker' in navigator, proto: location.protocol }));
  check('same page over https through nginx: secure context with WebCrypto + Service Worker (loopback origin — see LIMITS)', sec.secure && sec.subtle && sec.sw && sec.proto === 'https:', JSON.stringify(sec));
  const booted = await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 20000 }).then(() => true).catch(() => false);
  check('app boots over https through the proxy (autoInitApp finished, encryption key ready)', booted);
  await page.evaluate(() => openSettingsPanel()); await page.fill('#backendUrlInput', ORIGIN); await page.fill('#gatewayKeyInput', key); await page.click('button[onclick="saveBackendUrl()"]'); await sleep(600);
  await page.evaluate(() => { if (typeof closeSettingsPanel === 'function') closeSettingsPanel(); });
  await page.evaluate(() => { localStorage.setItem('nexus_local_model_name', 'fake-local:1b'); if (isSimpleMode()) toggleSimpleMode(); const sel = document.getElementById('chatModelSelect'); sel.value = 'ollama'; saveChatModelSetting(); });
  await page.fill('#msgInput', 'اختبار TLS'); await page.click('#sendBtn');
  await page.waitForFunction(() => !isSendingMessage && !document.getElementById('sendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
  await sleep(500);
  const last = await page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
  check('chat works end-to-end over https -> nginx -> backend -> (simulated) model', /رد محاكى عبر TLS/.test(last) && localHits >= 1, `${last.slice(0, 60)} hits=${localHits}`);
  const h = await page.evaluate(async (o) => { const r = await fetch(o + '/v2/health'); return { ok: r.ok, hsts: r.headers.get('strict-transport-security') }; }, ORIGIN);
  check('API reached through the proxy carries Strict-Transport-Security (now meaningful: the response is HTTPS)', h.ok && /max-age=\d+/.test(h.hsts || ''), JSON.stringify(h));
  const spoof = await page.evaluate(async (o) => (await fetch(o + '/__xff_echo', { headers: { 'X-Forwarded-For': '203.0.113.99, 198.51.100.7' } })).json(), ORIGIN);
  check('proxy REPLACES a client-supplied X-Forwarded-For with the real peer address (no spoofed hop forwarded)', spoof.xff && !/203\.0\.113\.99|198\.51\.100\.7/.test(spoof.xff) && spoof.xff.split(',').length === 1 && spoof.proto === 'https', JSON.stringify(spoof));
  const ss = spawnSync('sh', ['-c', 'ss -ltnH 2>/dev/null || netstat -ltn 2>/dev/null']).stdout.toString();
  const locals = ss.split('\n').map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 4 && f[3].endsWith(':' + API)).map((f) => f[3]); // `ss -ltnH`: State Recv-Q Send-Q Local Peer
  check('backend listens on 127.0.0.1 only (never 0.0.0.0 / ::); only the TLS port is the public entry', locals.length > 0 && locals.every((a) => a.startsWith('127.0.0.1:')), locals.join(',') || 'no listener found');
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '');
  check('no page errors during the https session', errors.length === 0, errors.join(' | '));
  await ctx.close();
} finally { await browser.close(); ng.kill('SIGTERM'); run.kill('SIGTERM'); fake.close(); echo.close(); }
const bad = results.filter((r) => !r.ok).length;
console.log(`SUMMARY ${results.length - bad}/${results.length} passed${bad ? ' — FAILURES' : ''}; TLS-PROXY-VERDICT = ${bad ? 'REJECTED' : 'ACCEPTED'} (REAL nginx + REAL Chromium + self-signed cert; SIMULATED model; a trusted CA certificate and a real second device are NOT exercised)`);
process.exit(bad ? 1 : 0);
