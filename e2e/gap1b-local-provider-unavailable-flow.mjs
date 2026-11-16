/* ==========================================================================
   e2e/gap1b-local-provider-unavailable-flow.mjs — GAP-1/GAP-1B: what the REAL frontend does when the backend answers
   503 `local_provider_unavailable` (local provider down, cloud fallback blocked).
   Real Chromium loads the real frontend; the REAL backend process (src-baseline/nexus-backend/src/index.ts via tsx) serves it. The providers are FAKES
   (a broken local "ollama" and a metering fake "anthropic"): this proves the frontend/backend contract only — NOT a real Ollama, NOT a real cloud API.
   Checks (VALID = the harness is trustworthy; PS = product behaviour):
     - the cloud meter is live (control) and the backend itself returns 503 for provider:"ollama" without touching the cloud;
     - frontend callClaude() (non-stream AND stream) REJECTS (never a false success) and the user-facing message contains the explanation;
     - NOT ONE request reaches the fake cloud during the whole UI flow, including NexusOrchestrator.callResilient's retries;
     - a plain cloud request through the same UI path DOES register on the meter.
   Final line: GAP1B-UI-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED.
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '../frontend');
const BACKEND_DIR = path.resolve(HERE, '../src-baseline/nexus-backend');
const RESULTS_FILE = process.env.NEXUS_GAP1B_UI_RESULTS || path.join(os.tmpdir(), 'gap1b-ui-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const KEY = 'LAN-e2e-key-Qw8Zr3Lm5Xv7Tn2B-0001';
const MARKER = 'CONFIDENTIAL-ui-flow-3c71';
const EXPLANATION = 'لم يُرسَل أي محتوى إلى مزود سحابي';

const checks = [];
function rec(kind, name, ok, detail) { checks.push({ kind, name, ok: !!ok, detail: detail ?? null }); console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`); }
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const canConnect = (port) => new Promise((res) => { const c = net.connect({ port, host: '127.0.0.1' }); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });

// --- fakes ---------------------------------------------------------------------------------------------------------------------------------
let localHits = 0;
const cloudLog = []; // every request the fake CLOUD received (the egress meter)
const brokenLocal = http.createServer(async (req, res) => { for await (const _ of req) void _; localHits++; res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'local model server down' })); });
const fakeCloud = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  cloudLog.push({ url: req.url, bodyHasMarker: Buffer.concat(chunks).toString('utf8').includes(MARKER) });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'text', text: 'cloud answered' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
});
const listen = (s, port) => new Promise((r) => s.listen(port, '127.0.0.1', r));

const fePort = await freePort(); const bePort = await freePort(); const localPort = await freePort(); const cloudPort = await freePort();
const feOrigin = `http://127.0.0.1:${fePort}`; const beOrigin = `http://127.0.0.1:${bePort}`;
await listen(brokenLocal, localPort); await listen(fakeCloud, cloudPort);

const feServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
  const abs = path.resolve(FRONTEND_DIR, rel);
  if (!abs.startsWith(FRONTEND_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(abs); res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await listen(feServer, fePort);

let out = '';
const be = spawn(path.join(BACKEND_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], {
  cwd: BACKEND_DIR,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXUS_DB_PATH: ':memory:', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(bePort), NEXUS_GATEWAY_KEYS: KEY,
    NEXUS_CORS_ORIGINS: feOrigin, NEXUS_LOG_LEVEL: 'warn', NEXUS_RATE_LIMIT_PER_MINUTE: '600', NEXUS_RATE_LIMIT_BURST: '100', NEXUS_MAX_RETRIES: '0',
    NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${localPort}`, NEXUS_MODEL_OLLAMA: 'llama3.1',
    NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudPort}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
be.stdout.on('data', (d) => (out += d)); be.stderr.on('data', (d) => (out += d));
let up = false;
for (let i = 0; i < 300 && !up; i++) { up = await canConnect(bePort); if (!up) await new Promise((r) => setTimeout(r, 100)); }
valid('V1 the real backend process started and listens', up, up ? null : out.slice(0, 300));

const browser = await chromium.launch();
try {
  const auth = { 'content-type': 'application/json', Authorization: 'Bearer ' + KEY };

  // VALID controls, independent of the browser
  let before = cloudLog.length;
  const direct = await fetch(beOrigin + '/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ provider: 'ollama', max_tokens: 20, messages: [{ role: 'user', content: MARKER }] }) });
  const directBody = await direct.json().catch(() => ({}));
  valid('V2 control: the backend itself answers provider:"ollama" with 503 local_provider_unavailable', direct.status === 503 && directBody?.error?.code === 'local_provider_unavailable', `${direct.status}/${directBody?.error?.code}`);
  valid('V3 control: that direct call sent nothing to the fake cloud', cloudLog.length === before, `cloud requests=${cloudLog.length - before}`);
  before = cloudLog.length;
  const directCloud = await fetch(beOrigin + '/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ provider: 'anthropic', max_tokens: 20, messages: [{ role: 'user', content: 'control' }] }) });
  valid('V4 control: the egress meter is live — an explicit cloud request registers on the fake cloud', directCloud.status === 200 && cloudLog.length - before === 1, `${directCloud.status}/${cloudLog.length - before}`);

  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(feOrigin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', beOrigin);
  await page.fill('#gatewayKeyInput', KEY);
  await page.click('button[onclick="saveBackendUrl()"]');
  await page.evaluate(() => localStorage.setItem('nexus_local_model_name', 'llama3.1'));

  const uiCloudBefore = cloudLog.length;
  const localBefore = localHits;

  // 1) frontend, NON-stream
  const nonStream = await page.evaluate(async (m) => {
    try { const r = await callClaude('system', m, [], 'ollama', false, null, null); return { resolved: true, value: JSON.stringify(r).slice(0, 200) }; }
    catch (e) { return { resolved: false, message: String(e && e.message) }; }
  }, MARKER);
  ps('U1 non-stream: callClaude(provider=ollama) REJECTS — no false success', nonStream.resolved === false, nonStream.resolved ? nonStream.value : null);
  ps('U2 non-stream: the user-facing error carries the 503 and the Arabic explanation that nothing went to the cloud', nonStream.resolved === false && /503/.test(nonStream.message) && nonStream.message.includes(EXPLANATION), (nonStream.message || '').slice(0, 220));

  // 2) frontend, STREAM
  const stream = await page.evaluate(async (m) => {
    try { const ac = new AbortController(); const r = await callClaude('system', m, [], 'ollama', false, null, { onToken() {}, signal: ac.signal }); return { resolved: true, value: JSON.stringify(r).slice(0, 200) }; }
    catch (e) { return { resolved: false, message: String(e && e.message) }; }
  }, MARKER);
  ps('U3 stream: callClaude(provider=ollama, streaming) REJECTS — no false success', stream.resolved === false, stream.resolved ? stream.value : null);
  ps('U4 stream: the error shown to the user includes the Arabic explanation', stream.resolved === false && stream.message.includes(EXPLANATION), (stream.message || '').slice(0, 220));

  // 3) the app's own retry wrapper (what real call sites use): retries stay local, error still surfaces
  const hitsBeforeResilient = localHits;
  const resilient = await page.evaluate(async (m) => {
    try { await NexusOrchestrator.callResilient(() => callClaude('system', m, [], 'ollama', false, null, null), { provider: 'ollama', maxRetries: 1, fallbackProviders: ['anthropic'] }); return { resolved: true }; }
    catch (e) { return { resolved: false, message: String(e && e.message) }; }
  }, MARKER);
  ps('U5 callResilient: the error still surfaces after its retries (no false success)', resilient.resolved === false, (resilient.message || '').slice(0, 260));
  const resilientLocalHits = localHits - hitsBeforeResilient;
  ps('U6 callResilient: its retries all went to the LOCAL provider (backend local hits >= 2), never anywhere else', resilientLocalHits >= 2, `local hits during callResilient=${resilientLocalHits}`);
  const suggestsCloud = /جرّب التبديل إلى/.test(resilient.message || '');
  console.log(`[INFO] callResilient appends a manual provider SUGGESTION in the message: ${suggestsCloud} (a text hint only — it never re-sends the request)`);

  ps('U7 NOT ONE request reached the fake cloud during the entire UI flow (non-stream, stream, retries)', cloudLog.length === uiCloudBefore, `cloud requests during UI flow=${cloudLog.length - uiCloudBefore}; local hits=${localHits - localBefore}`);
  ps('U8 no uncaught page errors during the flow', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

  // control through the SAME frontend path: a cloud request registers on the meter
  const cloudBeforeCtl = cloudLog.length;
  const ctl = await page.evaluate(async () => {
    try { const r = await callClaude('system', 'plain cloud request', [], 'anthropic', false, null, null); return { resolved: true, value: JSON.stringify(r).slice(0, 120) }; }
    catch (e) { return { resolved: false, message: String(e && e.message) }; }
  });
  valid('V5 control: the same frontend path with provider=anthropic succeeds and registers on the fake cloud meter', ctl.resolved === true && cloudLog.length - cloudBeforeCtl >= 1, ctl.resolved ? `cloud requests=${cloudLog.length - cloudBeforeCtl}` : ctl.message);
  await ctx.close();
} finally {
  await browser.close();
  be.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1500)); be.kill('SIGKILL');
  feServer.close(); feServer.closeAllConnections?.(); brokenLocal.close(); fakeCloud.close();
}

const vFail = checks.filter((c) => c.kind === 'VALID' && !c.ok); const pFail = checks.filter((c) => c.kind === 'PS' && !c.ok);
const verdict = vFail.length ? 'INVALID' : pFail.length ? 'REJECTED' : 'ACCEPTED';
console.log(`SUMMARY VALID ${checks.filter((c) => c.kind === 'VALID' && c.ok).length}/${checks.filter((c) => c.kind === 'VALID').length}  PS ${checks.filter((c) => c.kind === 'PS' && c.ok).length}/${checks.filter((c) => c.kind === 'PS').length}`);
console.log(`GAP1B-UI-VERDICT = ${verdict}`);
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, checks: checks.map((c) => ({ kind: c.kind, name: c.name, ok: c.ok, detail: c.detail })) }, null, 2));
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
