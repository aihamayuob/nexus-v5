import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_DIR = new URL('../frontend', import.meta.url).pathname;
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const BACKEND_DIR = new URL('../src-baseline/nexus-backend', import.meta.url).pathname;
const BACKEND_PORT = 8799;
const STATIC_PORT = 8899;
const GATEWAY_KEY = 'nexus_e2e_baseline_key';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. Static file server for the frontend HTML
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const staticServer = createServer(async (req, res) => {
  try {
    const urlPath = req.url === '/' ? HTML_FILE : decodeURIComponent(req.url.slice(1));
    const filePath = path.join(FRONTEND_DIR, urlPath);
    const content = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((resolve) => staticServer.listen(STATIC_PORT, resolve));
log('static-server-boot', true, `serving ${HTML_FILE} on :${STATIC_PORT}`);

// 2. Spawn the real compiled backend
const backend = spawn('node', ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, NEXUS_PORT: String(BACKEND_PORT), NEXUS_GATEWAY_KEYS: GATEWAY_KEY, NEXUS_CORS_ORIGINS: `http://127.0.0.1:${STATIC_PORT}` },
});
let backendLog = '';
backend.stdout.on('data', (d) => (backendLog += d.toString()));
backend.stderr.on('data', (d) => (backendLog += d.toString()));
await new Promise((r) => setTimeout(r, 2000));
log('backend-boot', backendLog.includes('Nexus backend listening'), backendLog.trim().split('\n').pop());

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err)));

// 3. Load the page
await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
const title = await page.title();
log('page-load', title.includes('Neural Nexus'), `title="${title}"`);

// 4. Point the app at our real backend + gateway key via the Settings panel
await page.evaluate(() => { closeSideMenu?.(); openSettingsPanel(); });
await page.waitForTimeout(300);
const settingsVisible = await page.locator('#settingsModal').evaluate((el) => getComputedStyle(el).display !== 'none');
log('settings-modal-open', settingsVisible);

await page.fill('#backendUrlInput', `http://127.0.0.1:${BACKEND_PORT}`);
await page.fill('#gatewayKeyInput', GATEWAY_KEY);
await page.evaluate(() => saveBackendUrl());
const savedUrl = await page.evaluate(() => localStorage.getItem('nexus_backend_url'));
log('settings-save-backend-url', savedUrl === `http://127.0.0.1:${BACKEND_PORT}`, `stored="${savedUrl}"`);
await page.evaluate(() => closeModal('settingsModal'));

// 5. Toggle Advanced Mode on (Ops Center / Workspace triggers are gated behind it) then check triggers
const hasSimpleModeToggle = await page.evaluate(() => typeof toggleSimpleMode === 'function' || typeof setSimpleMode === 'function');
log('simple-mode-toggle-fn-exists', hasSimpleModeToggle);

// Try common toggle entry points defensively (structure discovery, no assumptions)
await page.evaluate(() => {
  if (typeof setSimpleMode === 'function') { setSimpleMode(false); return; }
  if (typeof toggleSimpleMode === 'function') { toggleSimpleMode(); return; }
  document.body.classList.remove('simple-mode');
});
await page.waitForTimeout(200);
const isAdvanced = await page.evaluate(() => !document.body.classList.contains('simple-mode'));
log('advanced-mode-active', isAdvanced);

// 6. Open NEXUS Ops Center modal directly via its function (per memory: relocated trigger lives inside an advanced-only accordion)
const opsFnExists = await page.evaluate(() => typeof openNexusOps === 'function' || typeof window.openNexusOps === 'function');
if (!opsFnExists) {
  // discover the real opener name from the modal's own open call site pattern
}
await page.evaluate(() => {
  // The modal is shown by setting display=flex; call whichever opener exists.
  if (typeof openNexusOps === 'function') return openNexusOps();
  if (typeof openOpsCenter === 'function') return openOpsCenter();
  throw new Error('no known ops-center opener function found');
}).then(
  () => log('nexus-ops-opener-call', true),
  (e) => log('nexus-ops-opener-call', false, e.message)
);
const opsVisible = await page.locator('#nexusOpsModal').evaluate((el) => getComputedStyle(el).display !== 'none').catch(() => false);
log('nexus-ops-modal-visible', opsVisible);
if (opsVisible) await page.evaluate(() => closeModal('nexusOpsModal'));

// 7. Open Workspace modal
await page.evaluate(() => { if (typeof openWorkspace === 'function') openWorkspace('overview'); }).catch(() => {});
await page.waitForTimeout(200);
const wsVisible = await page.locator('#workspaceModal').evaluate((el) => getComputedStyle(el).display !== 'none').catch(() => false);
log('workspace-modal-visible', wsVisible);
if (wsVisible) await page.evaluate(() => closeModal('workspaceModal'));

// 8. Send a real chat message (no provider configured -> expect a clean, well-formatted error, not a crash)
await page.fill('#msgInput', 'اختبار أساسي — Phase 0 baseline');
await page.click('#sendBtn');
await page.waitForTimeout(2500);
const lastMsgText = await page.evaluate(() => document.getElementById('chatArea')?.innerText?.trim() ?? '(#chatArea not found)');
log('chat-send-no-crash', pageErrors.length === 0, pageErrors.join(' | '));
log('chat-send-error-content', /مفتاح|key|API|غير متاح|provider|مزوّد/i.test(lastMsgText), lastMsgText.slice(0, 200));

await browser.close();
staticServer.close();
backend.kill();

console.log('\n=== CONSOLE ERRORS ===');
console.log(consoleErrors.length ? consoleErrors.join('\n') : '(none)');
console.log('\n=== PAGE ERRORS ===');
console.log(pageErrors.length ? pageErrors.join('\n') : '(none)');
console.log('\n=== SUMMARY ===');
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} checks passed`);
console.log(JSON.stringify(results, null, 2));
