// NEXUS — compatibility probe: (A) the OLD single-file UI the owner uploaded (path in $OLD_UI_HTML) and (B) the repo's LATEST frontend (frontend/, served by
// scripts/nexus-run.mjs) are each driven through the SAME real-browser flow against the SAME built backend (separate process, on-disk SQLite).
// Models are SIMULATED (fake Ollama-protocol local + fake Anthropic-protocol cloud on 127.0.0.1). The old file is served over HTTP from a tiny static server
// whose origin is added to the backend's NEXUS_CORS_ORIGINS allow-list (env only — backend code and CORS policy are NOT changed).
// It reports every backend request each UI makes (path + HTTP status). It proves plumbing/compat, not model quality, and not full feature coverage.
// Usage: OLD_UI_HTML=/path/to/old.html node e2e/old-vs-latest-ui-compat.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const OLD = process.env.OLD_UI_HTML;
if (!OLD) { console.error('set OLD_UI_HTML'); process.exit(2); }
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d: d == null ? '' : String(d) }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };

const hits = { local: 0, cloud: 0 };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };
const local = createServer(async (req, res) => {
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  await readBody(req); hits.local++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'SIM-LOCAL-REPLY رد محاكى من النموذج المحلي.' }, done: true, prompt_eval_count: 3, eval_count: 9 }));
});
const cloud = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
  const body = await readBody(req); hits.cloud++;
  const text = 'SIM-CLOUD-REPLY رد محاكى من السحابة.';
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
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
await Promise.all([listen(local), listen(cloud)]);

// static server for the OLD file (HTTP origin, so it can be allow-listed; file:// has origin "null" and is rejected by design)
const OLD_PORT = 18900 + Math.floor(Math.random() * 300);
const oldBytes = readFileSync(OLD);
const oldSrv = createServer((req, res) => {
  if (req.url === '/' || req.url.startsWith('/old.html')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(oldBytes); }
  res.writeHead(404); res.end();
});
await new Promise((r) => oldSrv.listen(OLD_PORT, '127.0.0.1', r));

const UI = 18400 + Math.floor(Math.random() * 400), API = UI + 500;
const db = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-compat-')), 'n.db');
const run = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-run.mjs')], {
  env: { ...process.env, NEXUS_UI_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_DB_PATH: db, NEXUS_LOG_LEVEL: 'warn',
    NEXUS_CORS_ORIGINS: `http://localhost:${UI},http://127.0.0.1:${UI},http://127.0.0.1:${OLD_PORT},http://localhost:${OLD_PORT}`,
    NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${local.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b',
    NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloud.address().port}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key', NEXUS_MAX_RETRIES: '0',
    NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; run.stdout.on('data', (d) => (out += d)); run.stderr.on('data', (d) => (out += d));
let key = null;
for (let i = 0; i < 60 && !key; i++) { await sleep(250); key = /Gateway key:\s+(\S+)/.exec(out)?.[1] || null; }
let up = false;
for (let i = 0; i < 60 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${API}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher up (latest UI + built backend), gateway key printed', !!key && up, key ? 'key printed (not logged)' : out.slice(0, 200));
const corsOld = await fetch(`http://127.0.0.1:${API}/v2/health`, { headers: { Origin: `http://127.0.0.1:${OLD_PORT}` } });
const corsEvil = await fetch(`http://127.0.0.1:${API}/v2/health`, { headers: { Origin: 'http://evil.example' } });
check('CORS is an allow-list: old-UI origin allowed via env, foreign origin NOT allowed', corsOld.headers.get('access-control-allow-origin') === `http://127.0.0.1:${OLD_PORT}` && !corsEvil.headers.get('access-control-allow-origin'), '');

const browser = await chromium.launch();
const matrix = {};
async function session(label, url, { viewport = { width: 1280, height: 800 }, via = 'ollama' } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'ar' });
  const page = await ctx.newPage();
  const errs = [], reqs = {};
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  page.on('response', (r) => { const u = new URL(r.url()); if (u.port === String(API)) { const k = `${r.request().method()} ${u.pathname.replace(/[A-Za-z0-9_\-]{12,}/g, ':id')}`; (reqs[k] = reqs[k] || new Set()).add(r.status()); } });
  await page.goto(url, { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 25000 }).then(() => true).catch(() => false);
  if (!ready) { errs.push('app did not finish initialising (encryptionKey)'); }
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', `http://127.0.0.1:${API}`);
  await page.fill('#gatewayKeyInput', key);
  await page.click('button[onclick="saveBackendUrl()"]');
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, 'shots', `compat-${label}-settings.png`) });
  await page.evaluate(() => { if (typeof closeSettingsPanel === 'function') closeSettingsPanel(); });
  await page.evaluate((v) => { localStorage.setItem('nexus_local_model_name', 'fake-local:1b'); if (isSimpleMode()) toggleSimpleMode(); const sel = document.getElementById('chatModelSelect'); sel.value = v; saveChatModelSetting(); }, via);
  await page.fill('#msgInput', 'مرحبًا، هل تعمل المنصة؟');
  await page.click('#sendBtn');
  await page.waitForFunction(() => !isSendingMessage && !document.getElementById('sendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
  await sleep(600);
  const last = await page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
  await page.screenshot({ path: path.join(OUT, 'shots', `compat-${label}-chat.png`) });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const dir = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
  const keyInStorage = await page.evaluate((k) => JSON.stringify({ l: Object.assign({}, localStorage), s: Object.assign({}, sessionStorage) }).includes(k), key);
  await ctx.close();
  return { last, errs, reqs: Object.fromEntries(Object.entries(reqs).map(([k, v]) => [k, [...v].sort().join('/')])), overflow, dir, keyInStorage };
}

for (const [label, url] of [['old-uploaded', `http://127.0.0.1:${OLD_PORT}/old.html`], ['latest-repo', `http://localhost:${UI}/NEXUS.html`]]) {
  const loc = await session(label + '-local', url, { via: 'ollama' });
  check(`[${label}] connect + chat via LOCAL (simulated Ollama) returns the model reply`, /SIM-LOCAL-REPLY/.test(loc.last), loc.last.slice(0, 80));
  const cl = await session(label + '-cloud', url, { via: 'anthropic' });
  check(`[${label}] chat via CLOUD (simulated Anthropic) returns the model reply`, /SIM-CLOUD-REPLY/.test(cl.last), cl.last.slice(0, 80));
  const ph = await session(label + '-phone', url, { viewport: { width: 390, height: 844 }, via: 'ollama' });
  check(`[${label}] phone 390px: chat works, no horizontal overflow`, /SIM-LOCAL-REPLY/.test(ph.last) && ph.overflow <= 1, `overflowPx=${ph.overflow}`);
  check(`[${label}] Arabic RTL applied`, loc.dir === 'rtl', loc.dir);
  const bad = Object.entries({ ...loc.reqs, ...cl.reqs }).filter(([, st]) => /(^|\/)(4\d\d|5\d\d)(\/|$)/.test(st));
  check(`[${label}] no backend request returned 4xx/5xx during connect+chat`, bad.length === 0, bad.map(([k, v]) => `${k}=${v}`).join('; '));
  check(`[${label}] no uncaught page errors`, loc.errs.length + cl.errs.length + ph.errs.length === 0, [...loc.errs, ...cl.errs, ...ph.errs].slice(0, 3).join(' | '));
  check(`[${label}] gateway key not persisted to local/sessionStorage`, !loc.keyInStorage, '');
  matrix[label] = { requests: { ...loc.reqs, ...cl.reqs }, overflowPhone: ph.overflow };
}
check('the simulated model servers really received the traffic from both UIs', hits.local >= 4 && hits.cloud >= 2, JSON.stringify(hits));

await browser.close(); run.kill('SIGTERM'); local.close(); cloud.close(); oldSrv.close();
writeFileSync(path.join(OUT, 'old-vs-latest-ui-compat.json'), JSON.stringify({ ranAt: new Date().toISOString(), simulated: true, oldFileSha256: 'see log', matrix, results }, null, 2));
console.log('\nBACKEND REQUESTS PER UI (method path => statuses):');
for (const [k, m] of Object.entries(matrix)) { console.log(`-- ${k}`); for (const [r, s] of Object.entries(m.requests).sort()) console.log(`   ${r} => ${s}`); }
const fails = results.filter((r) => !r.ok).length;
console.log(`\nold-vs-latest-ui-compat: ${results.length - fails}/${results.length} PASS, ${fails} FAIL (models SIMULATED)`);
process.exit(fails ? 1 : 0);
