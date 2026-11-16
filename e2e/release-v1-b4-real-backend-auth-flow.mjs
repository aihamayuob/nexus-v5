/* ==========================================================================
   e2e/release-v1-b4-real-backend-auth-flow.mjs — Release V1, B4: the memory-only key against the REAL backend process.
   Spawns the real backend (src-baseline/nexus-backend/src/index.ts via tsx; same process the release ships) with NEXUS_GATEWAY_KEYS set,
   bound to loopback, CORS allowing only the test frontend origin. Real Chromium loads the real frontend from a static server.
   The browser origin and the backend origin DIFFER (the documented deployment shape), so real CORS applies.

   Scope (honest): this proves the AUTH path only — the key typed in the real settings UI reaches the real backend as a Bearer token and is
   accepted (200), a wrong key is refused (401), a reload (memory wiped) is refused (401) — plus real response headers. It does NOT exercise
   chat/streaming/providers (no provider key exists in this environment: those stay PENDING — DATA NOT EXECUTED).
   Final line: B4RB-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED.
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
const RESULTS_FILE = process.env.NEXUS_B4RB_RESULTS || path.join(os.tmpdir(), 'release-v1-b4rb-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const KEY = 'LAN-e2e-key-Qw8Zr3Lm5Xv7Tn2B-0001';
const WRONG = 'LAN-e2e-key-WRONG-wrong-wrong-0000';

const checks = [];
function rec(kind, name, ok, detail) { checks.push({ kind, name, ok: !!ok, detail: detail ?? null }); console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`); }
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const canConnect = (port) => new Promise((res) => { const c = net.connect({ port, host: '127.0.0.1' }); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });

const fePort = await freePort();
const bePort = await freePort();
const feOrigin = `http://127.0.0.1:${fePort}`;
const beOrigin = `http://127.0.0.1:${bePort}`;

const feServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
  const abs = path.resolve(FRONTEND_DIR, rel);
  if (!abs.startsWith(FRONTEND_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(abs); res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => feServer.listen(fePort, '127.0.0.1', r));

let out = '';
const be = spawn('tsx', ['src/index.ts'], {
  cwd: BACKEND_DIR,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXUS_DB_PATH: ':memory:', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(bePort), NEXUS_GATEWAY_KEYS: KEY,
    NEXUS_CORS_ORIGINS: feOrigin, NEXUS_LOG_LEVEL: 'info', NEXUS_RATE_LIMIT_PER_MINUTE: '600', NEXUS_RATE_LIMIT_BURST: '100' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
be.stdout.on('data', (d) => (out += d)); be.stderr.on('data', (d) => (out += d));
let up = false;
for (let i = 0; i < 300 && !up; i++) { up = await canConnect(bePort); if (!up) await new Promise((r) => setTimeout(r, 100)); }
valid('V1 the real backend process started and listens', up, up ? null : out.slice(0, 300));

const browser = await chromium.launch();
try {
  // control: the backend itself enforces the key (curl-level, independent of the browser)
  const noKey = await fetch(beOrigin + '/v2/models'); const withKey = await fetch(beOrigin + '/v2/models', { headers: { Authorization: 'Bearer ' + KEY } });
  valid('V2 control: backend refuses no key (401) and accepts the right key (200) when called directly', noKey.status === 401 && withKey.status === 200, `${noKey.status}/${withKey.status}`);

  const ctx = await browser.newContext(); const page = await ctx.newPage();
  const cspHits = []; const pageErrors = []; const consoleTexts = []; const models = [];
  await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective)); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => consoleTexts.push(m.text()));
  page.on('response', async (r) => { if (r.url() === beOrigin + '/v2/models') models.push({ status: r.status(), csp: r.headers()['content-security-policy'], acao: r.headers()['access-control-allow-origin'], sent: r.request().headers()['authorization'] ?? null }); });

  await page.goto(feOrigin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });

  const enter = async (key) => {
    await page.evaluate(() => openSettingsPanel());
    await page.fill('#backendUrlInput', beOrigin);
    await page.fill('#gatewayKeyInput', key);
    await page.click('button[onclick="saveBackendUrl()"]');
  };
  const ask = async () => { models.length = 0; await page.evaluate(() => syncProviderCatalogFromBackend()); await page.waitForTimeout(300); return models.slice(); };

  await enter(KEY);
  const good = await ask();
  ps('R1 the key typed in the real settings UI is accepted by the real backend (200, Bearer sent)', good.length >= 1 && good.every((m) => m.status === 200 && m.sent === 'Bearer ' + KEY), JSON.stringify(good.map((m) => m.status)));
  ps('R2 cross-origin works under the CSP + CORS allow-list (ACAO = the frontend origin, no CSP violation)', good.length >= 1 && good[0].acao === feOrigin && (await page.evaluate(() => window.__csp)).length === 0);
  ps('R3 the real backend response carries the API security headers', good.length >= 1 && good[0].csp === "default-src 'none'; frame-ancestors 'none'");

  await enter(WRONG);
  const bad = await ask();
  ps('R4 a wrong key typed in the UI is refused by the real backend (401)', bad.length >= 1 && bad.every((m) => m.status === 401), JSON.stringify(bad.map((m) => m.status)));

  await enter(KEY);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
  const afterReload = await ask();
  ps('R5 after a reload (memory wiped) the real backend refuses the request (401, no Authorization sent)', afterReload.length >= 1 && afterReload.every((m) => m.status === 401 && m.sent === null), JSON.stringify(afterReload.map((m) => [m.status, m.sent])));

  const leaked = [...consoleTexts, ...pageErrors, out].some((t) => t.includes(KEY) || t.includes(WRONG));
  ps('R6 neither the browser console nor the backend process output ever contains a key', !leaked);
  const stored = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage } }));
  ps('R7 browser web storage holds no key after the whole flow', !stored.includes(KEY) && !stored.includes(WRONG));
  await ctx.close();
} finally {
  await browser.close();
  be.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1500)); be.kill('SIGKILL');
  feServer.close(); feServer.closeAllConnections?.();
}

const vFail = checks.filter((c) => c.kind === 'VALID' && !c.ok); const pFail = checks.filter((c) => c.kind === 'PS' && !c.ok);
const verdict = vFail.length ? 'INVALID' : pFail.length ? 'REJECTED' : 'ACCEPTED';
console.log(`SUMMARY VALID ${checks.filter((c) => c.kind === 'VALID' && c.ok).length}/${checks.filter((c) => c.kind === 'VALID').length}  PS ${checks.filter((c) => c.kind === 'PS' && c.ok).length}/${checks.filter((c) => c.kind === 'PS').length}`);
console.log(`B4RB-VERDICT = ${verdict}`);
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, checks: checks.map((c) => ({ kind: c.kind, name: c.name, ok: c.ok })) }, null, 2));
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
