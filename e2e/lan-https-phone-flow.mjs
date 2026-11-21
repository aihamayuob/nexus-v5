// NEXUS — E2E for scripts/nexus-lan-https.mjs (same-network HTTPS front used so a PHONE can open the standalone page).
// Real Chromium (phone viewport, cert errors bypassed like a user clicking through the self-signed warning) -> https front -> BUILT backend (real process).
// Models are SIMULATED (fake Anthropic-protocol server on 127.0.0.1). Peer = loopback in this sandbox: a REAL second device on a REAL Wi-Fi is NOT exercised (UNVERIFIED).
// Usage: (cd src-baseline/nexus-backend && npm ci && npm run build) && (cd e2e && npm i --no-save playwright@1.63.0) && node e2e/lan-https-phone-flow.mjs
import { chromium } from 'playwright';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const SCRIPT = path.join(ROOT, 'scripts/nexus-lan-https.mjs');
const TLS_DIR = path.join(ROOT, '.nexus-lan-tls');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d: d == null ? '' : String(d).slice(0, 300) }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };
const KEY = 'lan-key-' + 'Zx8Cv2Bn6Mq4Lk0J'; // test-only, never a real secret
const HOST = '127.0.0.1';

const lib = await import(SCRIPT);

// ---------- pure logic ----------
check('isPrivateIPv4: RFC1918 + loopback + link-local accepted', ['10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.20', '127.0.0.1', '169.254.3.4'].every(lib.isPrivateIPv4), '');
check('isPrivateIPv4: public/0.0.0.0/CGNAT/doc ranges/hostnames/garbage refused', ['0.0.0.0', '8.8.8.8', '172.32.0.1', '172.15.0.1', '100.64.0.1', '192.0.2.2', '192.169.1.1', '256.1.1.1', 'localhost', '', '1.2.3'].every((x) => !lib.isPrivateIPv4(x)), '');
check('isAllowedPeer: handles ::ffff: mapping, ::1; refuses public peers', lib.isAllowedPeer('::ffff:192.168.1.7') && lib.isAllowedPeer('::1') && !lib.isAllowedPeer('::ffff:203.0.113.9') && !lib.isAllowedPeer('8.8.8.8') && !lib.isAllowedPeer(undefined), '');
check('proxy paths: only /api /v2 /mcp /health prefixes', ['/api/chat', '/v2/missions', '/mcp', '/health', '/v2'].every(lib.isProxyPath) && ['/apix', '/etc/passwd', '/', '/NEXUS-Standalone.html', '/v22/x'].every((x) => !lib.isProxyPath(x)), '');
const h = lib.proxyRequestHeaders({ Host: 'evil', 'X-Forwarded-For': '203.0.113.99', Forwarded: 'for=1.2.3.4', 'X-Real-IP': '1.1.1.1', 'X-Forwarded-Host': 'x', Connection: 'keep-alive', Authorization: 'Bearer k', Origin: 'https://h:1' }, '::ffff:192.168.1.9', 8787);
check('proxy request headers: spoofed XFF/Forwarded/X-Real-IP/X-Forwarded-* dropped, XFF = real peer, Host rewritten, auth/origin kept', h['x-forwarded-for'] === '192.168.1.9' && !h.forwarded && !h['x-real-ip'] && !h['x-forwarded-host'] && !h.connection && h.host === '127.0.0.1:8787' && h.authorization === 'Bearer k' && h.origin === 'https://h:1' && h['x-forwarded-proto'] === 'https', JSON.stringify(h));

// ---------- refusals (real processes) ----------
for (const bad of ['0.0.0.0', '192.0.2.2', '8.8.8.8', 'example.com']) {
  const r = spawnSync(process.execPath, [SCRIPT, '--host', bad], { encoding: 'utf8', timeout: 15000 });
  check(`launcher refuses --host ${bad} (exit 2, nothing listening)`, r.status === 2 && /Refusing/.test(r.stderr), `${r.status} ${r.stderr.slice(0, 80)}`);
}
check('launcher refuses --cert without --key', spawnSync(process.execPath, [SCRIPT, '--host', HOST, '--cert', 'x.pem'], { encoding: 'utf8', timeout: 15000 }).status === 2, '');

// ---------- fake cloud provider ----------
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };
const cloudSrv = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
  const body = await readBody(req);
  const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system || '');
  const lastUser = JSON.stringify((body.messages || []).slice(-1)[0] || '');
  const reply = (text) => {
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const f = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
      f('message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } });
      f('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      f('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
      f('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
      f('message_stop', { type: 'message_stop' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
  };
  if (system.includes('أنت مخطط مهام')) return reply(JSON.stringify({ tasks: [
    { id: 'collect', description: 'TASK-COLLECT اجمع المعطيات', dependsOn: [] },
    { id: 'report', description: 'TASK-REPORT اكتب التقرير النهائي', dependsOn: ['collect'] }] }));
  if (system.includes('مراجع مستقل صارم')) return reply(JSON.stringify({ verdict: 'ok', issues: [] }));
  const m = /TASK-(COLLECT|REPORT)/.exec(lastUser);
  return reply(m ? 'SIMULATED-RESULT-' + m[1] : 'رد محاكى من السحابة');
});
await new Promise((r) => cloudSrv.listen(0, '127.0.0.1', r));
const cloudPort = cloudSrv.address().port;

const rnd = () => 20000 + Math.floor(Math.random() * 400);
async function startFront(tlsPort, apiPort, extraEnv = {}) {
  const p = spawn(process.execPath, [SCRIPT, '--host', HOST, '--port', String(tlsPort)], {
    env: { ...process.env, NEXUS_PORT: String(apiPort), NEXUS_GATEWAY_KEYS: KEY, NEXUS_DB_PATH: path.join(mkdtempSync(path.join(tmpdir(), 'nexus-lan-')), 'n.db'), NEXUS_LOG_LEVEL: 'warn',
      NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudPort}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key', NEXUS_MAX_RETRIES: '0',
      NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000', NEXUS_CORS_ORIGINS: '', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'] });
  p.log = ''; p.stdout.on('data', (d) => (p.log += d)); p.stderr.on('data', (d) => (p.log += d));
  for (let i = 0; i < 80; i++) { await sleep(250); if (await rq(tlsPort, '/v2/health').then((r) => r.status === 200).catch(() => false)) return p; if (p.exitCode != null) break; }
  return p;
}
// raw https client; trusts NOTHING by default (rejectUnauthorized:false) unless a CA is passed
const rq = (port, p, o = {}) => new Promise((resolve, reject) => {
  const r = httpsRequest({ host: HOST, port, path: p, method: o.method || 'GET', headers: o.headers || {}, rejectUnauthorized: !!o.ca, ca: o.ca }, (res) => { const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c).toString('utf8') })); });
  r.on('error', reject); r.end(o.body);
});

const TLS = rnd(), API = TLS + 500;
const front = await startFront(TLS, API);
const ORIGIN = `https://${HOST}:${TLS}`;
check('front starts: prints page URL, same-origin API address, cert fingerprint; backend not on the LAN address', /phone\/LAN HTTPS front is up/.test(front.log) && front.log.includes(`${ORIGIN}/NEXUS-Standalone.html`) && /Certificate SHA-256:\s+([0-9A-F]{2}:){31}[0-9A-F]{2}/.test(front.log), front.log.slice(0, 200));

// ---------- certificate ----------
const certPem = readFileSync(path.join(TLS_DIR, 'cert.pem'));
const x = new X509Certificate(certPem);
const days = (new Date(x.validTo) - new Date(x.validFrom)) / 864e5;
check('generated cert: SAN covers the host IP + localhost, EC P-256, serverAuth, not a CA, <=31 days', x.checkIP(HOST) && x.checkHost('localhost') && x.publicKey.asymmetricKeyType === 'ec' && /serverAuth|1\.3\.6\.1\.5\.5\.7\.3\.1/.test(String(x.keyUsage)) && x.ca === false && days <= 31, `${days.toFixed(1)}d ${x.subject}`);
check('private key file is not world/group readable (mode 600) and the dir is git-ignored', process.platform === 'win32' || (statSync(path.join(TLS_DIR, 'key.pem')).mode & 0o077) === 0, (statSync(path.join(TLS_DIR, 'key.pem')).mode & 0o777).toString(8));
check('cert PINNED as CA => TLS validates strictly (hostname/IP match, no rejectUnauthorized:false)', await rq(TLS, '/v2/health', { ca: certPem }).then((r) => r.status === 200).catch(() => false), '');
const gi = spawnSync('git', ['check-ignore', '-q', '.nexus-lan-tls/key.pem'], { cwd: ROOT });
check('git ignores .nexus-lan-tls/ (no key material can be committed by accident)', gi.status === 0, '');

// ---------- surface ----------
const page = await rq(TLS, '/NEXUS-Standalone.html');
check('page served over HTTPS with nosniff/no-store/DENY; "/" is an alias', page.status === 200 && page.headers['x-content-type-options'] === 'nosniff' && /no-store/.test(page.headers['cache-control']) && page.headers['x-frame-options'] === 'DENY' && (await rq(TLS, '/')).status === 200, '');
const sf = await rq(TLS, '/NEXUS-single-file.html');
check('single-file page: 200 if built, else 404 (never an error page leak)', [200, 404].includes(sf.status), sf.status);
const st = await Promise.all([rq(TLS, '/etc/passwd'), rq(TLS, '/standalone/NEXUS-Standalone.html'), rq(TLS, '/.nexus-lan-tls/key.pem'), rq(TLS, '/NEXUS-Standalone.html', { method: 'POST' }), rq(TLS, '/%2e%2e/%2e%2e/etc/passwd')]);
check('nothing else is reachable (arbitrary paths/key file 404, POST to page 405)', st[0].status === 404 && st[1].status === 404 && st[2].status === 404 && st[3].status === 405 && st[4].status === 404 && !st.some((r) => /PRIVATE KEY/.test(r.body)), st.map((r) => r.status).join(','));
const plain = await new Promise((resolve) => { const s = createServer(); s.close(); import('node:http').then(({ request }) => { const r = request({ host: HOST, port: TLS, path: '/', timeout: 4000 }, (res) => resolve('responded ' + res.statusCode)); r.on('error', (e) => resolve('error ' + e.code)); r.on('timeout', () => { r.destroy(); resolve('no-response'); }); r.end(); }); });
check('plain HTTP to the TLS port gets no application response (no cleartext fallback)', !/responded 2/.test(plain), plain);
const h1 = await rq(TLS, '/v2/health');
const noKey = await rq(TLS, '/v2/models');
const withKey = await rq(TLS, '/v2/models', { headers: { Authorization: 'Bearer ' + KEY } });
check('proxied API: health 200, no key => 401, real key => 200 (auth enforced by the backend behind the proxy)', h1.status === 200 && noKey.status === 401 && withKey.status === 200, `${h1.status}/${noKey.status}/${withKey.status}`);
const cors = await rq(TLS, '/v2/health', { headers: { Origin: ORIGIN } });
const corsBad = await rq(TLS, '/v2/health', { headers: { Origin: 'https://evil.example' } });
check('backend CORS allow-list = the HTTPS page origin only (foreign origin gets no ACAO)', cors.headers['access-control-allow-origin'] === ORIGIN && !corsBad.headers['access-control-allow-origin'], `${cors.headers['access-control-allow-origin']} / ${corsBad.headers['access-control-allow-origin']}`);
const direct = await fetch(`http://127.0.0.1:${API}/v2/health`).then((r) => r.status).catch(() => 'err');
// behavioural bind check (no `ss` needed): connect to the same ports on every OTHER local IPv4 address; both must be refused.
const { networkInterfaces } = await import('node:os'); const net = await import('node:net');
const others = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
const probe = (addr, port) => new Promise((res) => { const s = net.connect({ host: addr, port, timeout: 3000 }); s.on('connect', () => { s.destroy(); res('OPEN'); }); s.on('error', (e) => res(e.code)); s.on('timeout', () => { s.destroy(); res('TIMEOUT'); }); });
const bind = []; for (const a of others) for (const pt of [API, TLS]) bind.push(`${a}:${pt}=${await probe(a, pt)}`);
check(others.length ? 'bind check: on this machine\'s non-loopback address(es) BOTH the backend and the front port refuse connections (bound to 127.0.0.1 only)' : 'bind check (no non-loopback interface present => cannot probe; UNVERIFIED)', others.length === 0 || bind.every((b) => b.endsWith('=ECONNREFUSED')), bind.join(' ') || 'no non-loopback IPv4');
check('backend answers directly only on 127.0.0.1 (sanity)', direct === 200, direct);

// ---------- real browser, phone viewport ----------
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ar' });
const pg = await ctx.newPage();
const reqs = [], errs = [], cons = [];
pg.on('request', (r) => reqs.push({ url: r.url(), auth: r.headers()['authorization'] || '' }));
pg.on('pageerror', (e) => errs.push(String(e))); pg.on('console', (m) => cons.push(m.text()));
const shot = async (name) => { try { await pg.screenshot({ path: path.join(OUT, 'shots', `lan-${name}.png`), fullPage: true }); } catch { /* best effort */ } };
const txt = (sel) => pg.locator(sel).innerText();
try {
  await pg.goto(`${ORIGIN}/NEXUS-Standalone.html`);
  const sec = await pg.evaluate(() => ({ secure: window.isSecureContext, subtle: !!(window.crypto && window.crypto.subtle), proto: location.protocol }));
  check('secure context on https: isSecureContext + crypto.subtle available (the blocker of DEPLOYMENT-LAN §4 is removed)', sec.secure && sec.subtle && sec.proto === 'https:', JSON.stringify(sec));
  check('page loads RTL Arabic on a 390px viewport without horizontal overflow', (await pg.getAttribute('html', 'dir')) === 'rtl' && await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await pg.evaluate(() => `${document.documentElement.scrollWidth}/${window.innerWidth}`));
  await shot('connect-idle');
  await pg.fill('#baseUrl', ORIGIN); await pg.fill('#token', 'wrong-key-wrong-key-1'); await pg.click('#connectBtn');
  await pg.waitForSelector('#connectMsg .msg.bad');
  check('wrong key through the HTTPS front => 401 shown, not connected', /401/.test(await txt('#connectMsg')) && (await pg.locator('#banner.live').count()) === 0, await txt('#connectMsg'));
  await pg.fill('#baseUrl', ORIGIN); await pg.fill('#token', KEY); await pg.click('#connectBtn');
  await pg.waitForSelector('#banner.live', { timeout: 15000 });
  check('connect (API address = same https origin) => LIVE', (await txt('#banner')).includes(ORIGIN), await txt('#banner'));
  const ls = await pg.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) + document.cookie);
  check('key not stored in localStorage/sessionStorage/cookies; token field wiped', !ls.includes(KEY) && (await pg.inputValue('#token')) === '', ls.slice(0, 80));
  await pg.click('#tabs button[data-tab=missions]');
  await pg.fill('#objective', 'مهمة عبر HTTPS من الجوال'); await pg.click('#cVer'); await pg.click('#missionBtn');
  await pg.waitForSelector('#missionMsg .msg.ok');
  await pg.waitForFunction(() => /COMPLETED|FAILED|CANCELLED/.test((document.querySelector('#mstate') || {}).innerText || ''), null, { timeout: 60000 });
  const det = await txt('#mdetail');
  check('mission through the proxy reaches COMPLETED with the simulated result + SSE log section', /COMPLETED/.test(await txt('#mstate')) && /SIMULATED-RESULT-REPORT/.test(det) && /Execution log \(SSE\)|سجل التنفيذ/.test(det), det.slice(0, 100).replace(/\s+/g, ' '));
  await shot('mission-completed');
  const origins = new Set(reqs.map((r) => new URL(r.url).origin));
  check('page talked ONLY to its own https origin (no third party); Authorization only to it', origins.size === 1 && origins.has(ORIGIN) && reqs.filter((r) => r.auth).every((r) => r.url.startsWith(ORIGIN)), [...origins].join(' '));
  check('no uncaught page errors / CSP violations; key absent from console and page text', errs.length === 0 && !cons.some((c) => /Content Security Policy|Refused to/.test(c) || c.includes(KEY)) && !(await pg.evaluate(() => document.documentElement.innerText)).includes(KEY), errs.concat(cons.filter((c) => /Refused|Content Security/.test(c))).join('|').slice(0, 200));
  const tiny = await pg.evaluate(() => [...document.querySelectorAll('button, a, input[type=checkbox], select')].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => { const lab = e.type === 'checkbox' ? (e.closest('label') || (e.id && document.querySelector(`label[for="${e.id}"]`))) : null; const r = (lab || e).getBoundingClientRect(); return { n: `${e.tagName}#${e.id}${lab ? '(label-wrapped)' : ''}[${(e.innerText || '').slice(0, 12)}]`, w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => Math.min(x.w, x.h) < 24));
  check('touch targets: no visible control (checkboxes measured as their clickable <label>) smaller than 24px (WCAG 2.2 2.5.8 minimum; full conformance NOT assessed)', tiny.length === 0, tiny.map((x) => `${x.n} ${x.w}x${x.h}`).join('; '));
} catch (e) { check('browser phase threw', false, e && e.stack ? e.stack : e); }
await browser.close();

// ---------- XFF is replaced, so the per-IP failed-auth throttle cannot be dodged by spoofing ----------
front.kill('SIGTERM'); await sleep(800);
const TLS2 = rnd() + 500, API2 = TLS2 + 500;
const front2 = await startFront(TLS2, API2, { NEXUS_RATE_LIMIT_PER_MINUTE: '1', NEXUS_RATE_LIMIT_BURST: '4' });
const codes = [];
for (let i = 0; i < 14; i++) codes.push((await rq(TLS2, '/v2/models', { headers: { Authorization: 'Bearer wrong-wrong-wrong-' + i, 'X-Forwarded-For': `203.0.113.${i + 1}`, Forwarded: `for=198.51.100.${i + 1}` } })).status);
check('spoofed X-Forwarded-For/Forwarded on bad-key requests does NOT dodge the per-IP throttle (401s then 429)', codes[0] === 401 && codes.includes(429) && codes.indexOf(429) <= 6, codes.join(','));
check('a valid key is not starved by the attacker bucket (still 200)', (await rq(TLS2, '/v2/models', { headers: { Authorization: 'Bearer ' + KEY } })).status === 200, '');
front2.kill('SIGTERM'); await sleep(800);
check('both fronts stopped cleanly (no listener left)', await rq(TLS2, '/v2/health').then(() => false).catch(() => true), '');

cloudSrv.close();
rmSync(TLS_DIR, { recursive: true, force: true }); // leave no key material in the work tree
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, 'lan-https-phone-results.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\nlan-https-phone-flow: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL (models SIMULATED; peer = loopback, no real second device)`);
process.exit(failed.length ? 1 : 0);
