// NEXUS — E2E for the SINGLE-FILE build of the latest frontend (scripts/build-single-file.mjs -> frontend/dist/NEXUS-single-file.html).
// Real Chromium -> the one HTML file (served by scripts/nexus-run.mjs, same origin as the backend allow-list) -> BUILT backend process -> SIMULATED models
// (fake Ollama + fake Anthropic protocol on 127.0.0.1). Also loads the file from file:// (backend calls are blocked by CORS there BY DESIGN — only the UI is checked).
// Proves: the bundle is self-contained, CSP hash policy is enforced (negative control), app boots, chat works, embedded vendor libs load, nothing is fetched
// besides the HTML, no service worker, no key in storage, phone layout. It does NOT prove model quality, real providers, WCAG, or non-Chromium browsers.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };

// ---- build (fresh) + static checks
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-single-file.mjs')], { stdio: 'pipe' });
const SF = path.join(ROOT, 'frontend/dist/NEXUS-single-file.html');
let chk = true; try { execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-single-file.mjs'), '--check'], { stdio: 'pipe' }); } catch { chk = false; }
const html = readFileSync(SF, 'utf8');
check('build is reproducible (--check: output equals a fresh build from the repo sources)', chk, '');
check('self-contained: no <script src>, no stylesheet link, no CDN/framework URL', !/<script[^>]*\ssrc=/i.test(html) && !/<link[^>]+rel=["']?stylesheet/i.test(html) && !/(unpkg|jsdelivr|cdnjs|googleapis)/i.test(html), '');
const cspMeta = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] || '';
check("CSP: script-src = 3 sha256 hashes + blob:, no 'self'/'unsafe-inline'/'unsafe-eval' for scripts", /script-src ('sha256-[^']+' ){3}blob:;/.test(cspMeta) && !/(^|; )script-src [^;]*('unsafe-inline'|'unsafe-eval'|'self')/.test(cspMeta), cspMeta.slice(0, 120));
check('no provider-key-shaped strings in the file', !/(sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-)/.test(html.replace(/<script type="text\/plain"[\s\S]*?<\/script>/g, '')), '');

// ---- fakes + launcher
const hits = { local: 0, cloud: 0 };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };
const local = createServer(async (req, res) => {
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  await readBody(req); hits.local++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'SIM-LOCAL-REPLY رد محاكى.' }, done: true, prompt_eval_count: 3, eval_count: 9 }));
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
const UI = 18400 + Math.floor(Math.random() * 400), API = UI + 500;
const db = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-sf-')), 'n.db');
const run = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-run.mjs')], {
  env: { ...process.env, NEXUS_UI_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_DB_PATH: db, NEXUS_LOG_LEVEL: 'warn',
    NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${local.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b',
    NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloud.address().port}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key', NEXUS_MAX_RETRIES: '0',
    NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = ''; run.stdout.on('data', (d) => (out += d)); run.stderr.on('data', (d) => (out += d));
let key = null; for (let i = 0; i < 60 && !key; i++) { await sleep(250); key = /Gateway key:\s+(\S+)/.exec(out)?.[1] || null; }
let up = false; for (let i = 0; i < 60 && !up; i++) { await sleep(250); up = await fetch(`http://127.0.0.1:${API}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher up (backend + static server), gateway key printed', !!key && up, '');
const URL_SF = `http://localhost:${UI}/dist/NEXUS-single-file.html`;

// tamper variants (written into git-ignored frontend/dist, removed afterwards)
const injectedPath = path.join(ROOT, 'frontend/dist/_tamper-injected.html');
const modifiedPath = path.join(ROOT, 'frontend/dist/_tamper-modified.html');
{ const i = html.lastIndexOf('</body>'); writeFileSync(injectedPath, html.slice(0, i) + '<script>window.__injected=1</script>' + html.slice(i)); }
writeFileSync(modifiedPath, html.replace('function __nxVendorUrl(file, mime){', 'function __nxVendorUrl(file, mime){ /*tampered*/'));

const browser = await chromium.launch();
const mk = async (viewport = { width: 1280, height: 800 }) => {
  const ctx = await browser.newContext({ viewport, locale: 'ar', permissions: [] });
  const page = await ctx.newPage();
  page.__errs = []; page.__csp = []; page.__reqs = [];
  page.on('pageerror', (e) => page.__errs.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) page.__csp.push(m.text().slice(0, 160)); });
  page.on('request', (r) => page.__reqs.push(r.url()));
  return { ctx, page };
};
const ready = (page) => page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 25000 }).then(() => true).catch(() => false);
async function chat(page, via) {
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', `http://127.0.0.1:${API}`); await page.fill('#gatewayKeyInput', key);
  await page.click('button[onclick="saveBackendUrl()"]'); await sleep(1200);
  await page.evaluate(() => { if (typeof closeSettingsPanel === 'function') closeSettingsPanel(); });
  await page.evaluate((v) => { localStorage.setItem('nexus_local_model_name', 'fake-local:1b'); if (isSimpleMode()) toggleSimpleMode(); const s = document.getElementById('chatModelSelect'); s.value = v; saveChatModelSetting(); }, via);
  await page.fill('#msgInput', 'مرحبًا، هل تعمل المنصة؟'); await page.click('#sendBtn');
  await page.waitForFunction(() => !isSendingMessage && !document.getElementById('sendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
  await sleep(500);
  return page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
}

try {
  // ===== http, desktop =====
  const { ctx, page } = await mk();
  await page.goto(URL_SF, { waitUntil: 'load' });
  check('app boots from the single file (encryptionKey initialised)', await ready(page), '');
  check('module bridge works (window.escapeHtml / localStore / getGatewayKey are functions/objects)', await page.evaluate(() => typeof window.escapeHtml === 'function' && typeof window.localStore === 'object' && typeof window.getGatewayKey === 'function' && typeof window.PromptInjectionGuard === 'object'), '');
  check('no CSP violations and no page errors while booting', page.__csp.length === 0 && page.__errs.length === 0, [...page.__csp, ...page.__errs].join(' | '));
  const reply = await chat(page, 'ollama');
  check('connect + chat via LOCAL (simulated Ollama) returns the reply', /SIM-LOCAL-REPLY/.test(reply), reply.slice(0, 60));
  await page.screenshot({ path: path.join(OUT, 'shots', 'single-file-desktop-chat.png') });
  const store = await page.evaluate((k) => JSON.stringify({ l: Object.assign({}, localStorage), s: Object.assign({}, sessionStorage) }).includes(k), key);
  check('gateway key not persisted in local/sessionStorage', !store, '');
  // vendor libraries from embedded data (blob:)
  const v = await page.evaluate(async () => {
    const r = {};
    try { await loadScriptOnce(LIB_URLS.qrcode); r.qr = typeof QRCode; } catch (e) { r.qr = 'ERR ' + e.message; }
    try { await loadScriptOnce(LIB_URLS.jsQR); r.jsqr = typeof jsQR; } catch (e) { r.jsqr = 'ERR ' + e.message; }
    r.urls = [LIB_URLS.qrcode, LIB_URLS.pdfjs].map((u) => u.slice(0, 5));
    return r;
  });
  check('embedded qrcode.js and jsQR load from blob: URLs and expose their API', v.qr === 'function' && v.jsqr === 'function' && v.urls.every((u) => u === 'blob:'), JSON.stringify(v));
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length 48>>stream\nBT /F1 12 Tf 10 50 Td (NEXUS-PDF-CANARY) Tj ET\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R/Size 6>>\n%%EOF\n', 'latin1');
  const pdfText = await page.evaluate(async (b64) => { try { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return await extractPdfText(u.buffer); } catch (e) { return 'ERR ' + e.message; } }, pdf.toString('base64'));
  check('embedded pdf.js (module + worker from blob:) extracts text from a PDF', /NEXUS-PDF-CANARY/.test(pdfText), String(pdfText).slice(0, 80));
  check('no CSP violations after exercising chat + vendor libraries', page.__csp.length === 0, page.__csp.join(' | '));
  const own = page.__reqs.filter((u) => u.startsWith(`http://localhost:${UI}`));
  check('the UI origin served ONLY the one HTML file (no vendor/, app.js, main.js, sw.js, modules fetched)', own.length === 1 && /NEXUS-single-file\.html$/.test(own[0]), own.join(', '));
  check('no service worker registered (sw.js is not shipped in a single file)', (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0, '');
  check('no uncaught page errors during the run', page.__errs.length === 0, page.__errs.join(' | '));
  await ctx.close();

  // ===== cloud path =====
  const c2 = await mk(); await c2.page.goto(URL_SF); await ready(c2.page);
  const r2 = await chat(c2.page, 'anthropic');
  check('chat via CLOUD (simulated Anthropic) returns the reply', /SIM-CLOUD-REPLY/.test(r2), r2.slice(0, 60));
  await c2.ctx.close();

  // ===== phone =====
  const p = await mk({ width: 390, height: 844 }); await p.page.goto(URL_SF); await ready(p.page);
  const rp = await chat(p.page, 'ollama');
  const ov = await p.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const dir = await p.page.evaluate(() => getComputedStyle(document.documentElement).direction);
  await p.page.screenshot({ path: path.join(OUT, 'shots', 'single-file-phone-chat.png') });
  check('phone 390px: chat works, no horizontal overflow, Arabic RTL', /SIM-LOCAL-REPLY/.test(rp) && ov <= 1 && dir === 'rtl', `overflow=${ov} dir=${dir}`);
  await p.ctx.close();

  // ===== CSP negative controls =====
  const t1 = await mk(); await t1.page.goto(`http://localhost:${UI}/dist/_tamper-injected.html`); const ok1 = await ready(t1.page); await sleep(500);
  check('CSP negative control: an INJECTED inline script does not run (window.__injected undefined) and a violation is reported; the original app still boots', ok1 && (await t1.page.evaluate(() => window.__injected === undefined)) && t1.page.__csp.length > 0, t1.page.__csp[0] || 'no violation reported');
  await t1.ctx.close();
  const t2 = await mk(); await t2.page.goto(`http://localhost:${UI}/dist/_tamper-modified.html`); const ok2 = await ready(t2.page);
  check('CSP negative control: a MODIFIED approved script is blocked (hash mismatch) — the app does NOT boot', !ok2 && t2.page.__csp.length > 0, t2.page.__csp[0] || '');
  await t2.ctx.close();

  // ===== file:// =====
  const f = await mk(); await f.page.goto('file://' + SF); const okf = await ready(f.page);
  const fq = await f.page.evaluate(async () => { try { await loadScriptOnce(LIB_URLS.qrcode); return typeof QRCode; } catch (e) { return 'ERR ' + e.message; } });
  check('file://: the single file loads and boots with no CSP violation; embedded QR lib works (backend calls are blocked by CORS by design — not claimed)', okf && fq === 'function' && f.page.__csp.length === 0, `${okf} ${fq} ${f.page.__csp.join('|')}`);
  await f.page.screenshot({ path: path.join(OUT, 'shots', 'single-file-file-protocol.png') });
  await f.ctx.close();
  check('the simulated model servers received the traffic', hits.local >= 2 && hits.cloud >= 1, JSON.stringify(hits));
} catch (e) {
  check('E2E harness completed without an unexpected exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  await browser.close().catch(() => {}); run.kill('SIGTERM'); local.close(); cloud.close();
  for (const f of [injectedPath, modifiedPath]) { try { unlinkSync(f); } catch { /* ignore */ } }
}
const failed = results.filter((r) => !r.ok);
console.log(`\nsingle-file-build: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL (models SIMULATED)`);
if (failed.length) { for (const f of failed) console.log('  FAILED: ' + f.n); process.exit(1); }
