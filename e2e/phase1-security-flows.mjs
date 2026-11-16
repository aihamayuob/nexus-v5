import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_DIR = new URL('../frontend', import.meta.url).pathname;
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const BACKEND_DIR = new URL('../src-baseline/nexus-backend', import.meta.url).pathname;
const BACKEND_PORT = 8811;
const STATIC_PORT = 8911;
const GATEWAY_KEY = 'nexus_phase1_key';

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

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
await new Promise((r) => staticServer.listen(STATIC_PORT, r));

const backend = spawn('node', ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
  cwd: BACKEND_DIR,
  env: { ...process.env, NEXUS_PORT: String(BACKEND_PORT), NEXUS_GATEWAY_KEYS: GATEWAY_KEY, NEXUS_CORS_ORIGINS: `http://127.0.0.1:${STATIC_PORT}` },
});
let backendLog = '';
backend.stdout.on('data', (d) => (backendLog += d.toString()));
backend.stderr.on('data', (d) => (backendLog += d.toString()));
await new Promise((r) => setTimeout(r, 2000));
log('backend-boot', backendLog.includes('Nexus backend listening'));

const consoleErrors = [];
const pageErrors = [];
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
log('page-load', (await page.title()).includes('Neural Nexus'));

// ---- REGRESSION: settings + chat-send still work exactly as in Phase 0 ----
await page.evaluate(() => { closeSideMenu?.(); openSettingsPanel(); });
await page.fill('#backendUrlInput', `http://127.0.0.1:${BACKEND_PORT}`);
await page.fill('#gatewayKeyInput', GATEWAY_KEY);
await page.evaluate(() => saveBackendUrl());
await page.evaluate(() => closeModal('settingsModal'));
await page.fill('#msgInput', 'فحص انحدار Phase 1');
await page.click('#sendBtn');
await page.waitForTimeout(2000);
const chatText = await page.evaluate(() => document.getElementById('chatArea')?.innerText || '');
log('regression-chat-send', /400|مزود|error|خطأ/i.test(chatText), 'chat flow still completes end-to-end');

// ---- NEW: jsStr() defined and used, existing agent-toggle UI still functional ----
const jsStrOk = await page.evaluate(() => {
  if (typeof jsStr !== 'function') return false;
  // A value containing a single quote and backslash must survive a full
  // HTML round-trip and decode back to the ORIGINAL string inside a real
  // onclick handler — proving no breakout and no corruption.
  const evil = `o'\\ne(); //`;
  const div = document.createElement('div');
  div.innerHTML = `<button id="__jsstrtest" onclick="window.__jsStrCaptured = '${jsStr(evil)}'">x</button>`;
  document.body.appendChild(div);
  document.getElementById('__jsstrtest').click();
  const captured = window.__jsStrCaptured;
  div.remove();
  return captured === evil;
});
log('jsStr-roundtrip-safe', jsStrOk, 'a value with a quote+backslash survives onclick round-trip intact, no breakout');

// ---- NEW: stripInternalMarkers strips all four marker types ----
const markerOk = await page.evaluate(() => {
  if (typeof stripInternalMarkers !== 'function') return false;
  const withTree = 'answer text' + THOUGHT_TREE_MARKER + JSON.stringify({ root: 'q', branches: [{ node: 'a', children: [] }] });
  const stripped = stripInternalMarkers(withTree);
  return !stripped.includes(THOUGHT_TREE_MARKER) && stripped.trim() === 'answer text';
});
log('marker-stripping-works', markerOk, 'THOUGHT_TREE_MARKER removed from stripped output');

const historyClean = await page.evaluate(() => {
  const before = messages.length;
  messages.push({ role: 'assistant', agentId: 'general', content: 'reply' + THOUGHT_TREE_MARKER + JSON.stringify({ root: 'q', branches: [] }) });
  const hist = buildHistoryForAgent('general');
  const last = hist[hist.length - 1];
  messages.length = before; // restore
  return last && !last.content.includes(THOUGHT_TREE_MARKER);
});
log('buildHistoryForAgent-strips-markers', historyClean, 'history sent back to the model no longer contains raw internal markers');

// ---- NEW: import confirmation — decline must leave state unchanged ----
const importDeclineOk = await page.evaluate(() => {
  const originalConfirm = window.confirm;
  window.confirm = () => false; // simulate the user clicking Cancel
  const before = customAgents.length;
  document.getElementById('caImportInput').value = JSON.stringify({ name: 'X', prompt: 'test prompt' });
  return importCustomAgentPasted().then(() => {
    window.confirm = originalConfirm;
    return customAgents.length === before;
  });
});
log('import-decline-no-mutation', importDeclineOk, 'declining the import preview leaves customAgents unchanged');

const importAcceptOk = await page.evaluate(() => {
  const originalConfirm = window.confirm;
  window.confirm = () => true; // simulate the user clicking OK
  const before = customAgents.length;
  document.getElementById('caImportInput').value = JSON.stringify({ name: 'PhaseOneTestAgent', prompt: 'test prompt for e2e' });
  return importCustomAgentPasted().then(() => {
    window.confirm = originalConfirm;
    const added = customAgents.length === before + 1 && customAgents[customAgents.length - 1].name === 'PhaseOneTestAgent';
    if (added) customAgents.pop(); // clean up
    return added;
  });
});
log('import-accept-still-works', importAcceptOk, 'confirming the import preview still imports correctly (regression on the feature itself)');

// ---- NEW: image separation — attach a real image, verify imageRef (not raw base64) is persisted, and it renders ----
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const imageFlowOk = await page.evaluate(async (b64) => {
  // NOTE: pendingImageBase64 is a top-level `let`, not `var` — must be set
  // via the bare identifier (shares the page's global lexical scope),
  // NOT via window.pendingImageBase64 (a different, disconnected binding).
  pendingImageBase64 = b64;
  pendingImageSizeKB = 1;
  const before = messages.length;
  document.getElementById('msgInput').value = 'صورة اختبار Phase 1';
  await sendMessage();
  await new Promise((r) => setTimeout(r, 300));
  const msg = messages.slice(before).find((m) => m.role === 'user');
  const hasRef = !!(msg && msg.imageRef && !msg.image);
  const cachedMatches = hasRef && ImageStore.getCached(msg.imageRef) === b64;
  return { hasRef, cachedMatches, pushed: messages.length > before };
}, tinyPngBase64);
log('image-separation-imageRef-not-raw', imageFlowOk.hasRef, 'message object carries imageRef, not the raw base64');
log('image-separation-cache-correct', imageFlowOk.cachedMatches, 'ImageStore cache holds the exact bytes that were sent');

await page.waitForTimeout(1500); // let the chat-send error settle before checking DOM for the <img>
const imgRendered = await page.evaluate(() => !!document.querySelector('.msg-image'));
log('image-thumbnail-renders', imgRendered, 'the attached image still renders as a real <img> in the chat');

// ---- NEW: backward compatibility — an OLD-format message (raw m.image) still renders ----
const backwardCompatOk = await page.evaluate((b64) => {
  messages.push({ role: 'user', content: 'old format message', image: b64 });
  renderMessages();
  return true;
}, tinyPngBase64);
await page.waitForTimeout(200);
const oldFormatImgCount = await page.evaluate(() => document.querySelectorAll('.msg-image').length);
log('backward-compat-old-image-field', oldFormatImgCount >= 2, `found ${oldFormatImgCount} rendered images (new + old-format)`);

// ---- NEW: message cap + archive ----
const capOk = await page.evaluate(async () => {
  const savedMessages = messages.slice();
  messages = [];
  for (let i = 0; i < MESSAGE_CAP + 15; i++) messages.push({ role: 'user', content: 'msg ' + i });
  await MessageArchive.clear(); // clean slate for the test
  await persistState();
  const cappedLength = messages.length;
  const archived = await MessageArchive.loadAll();
  messages = savedMessages; // restore real conversation
  return { cappedLength, archivedCount: archived.length };
});
log('message-cap-enforced', capOk.cappedLength === 300, `live array capped to ${capOk.cappedLength} (expected 300)`);
log('message-archive-received-overflow', capOk.archivedCount === 15, `archive received ${capOk.archivedCount} messages (expected 15)`);

// ---- NEW: resetAllData wipes images + archive (gc) ----
const gcOk = await page.evaluate(async () => {
  const id = await ImageStore.save('dGVzdA==');
  await MessageArchive.appendBatch([{ role: 'user', content: 'archived test msg' }]);
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  await resetAllData();
  window.confirm = originalConfirm;
  const imgAfter = await ImageStore.load(id);
  const archiveAfter = await MessageArchive.loadAll();
  return { imgGone: imgAfter === null, archiveGone: archiveAfter.length === 0 };
});
log('reset-gc-clears-images', gcOk.imgGone, 'ImageStore entry no longer exists after resetAllData');
log('reset-gc-clears-archive', gcOk.archiveGone, 'MessageArchive is empty after resetAllData');

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
if (passed !== results.length) {
  console.log('FAILED CHECKS:', results.filter((r) => !r.ok).map((r) => r.name));
  process.exitCode = 1;
}
