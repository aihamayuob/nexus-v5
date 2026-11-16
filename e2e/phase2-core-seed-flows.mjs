/* ==========================================================================
   e2e/phase2-core-seed-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9
   "core", first TARGET SLICE: encryptState / decryptState.

   Real Chromium against the real HTML + real modules (no mocks). Proves the
   seam both directly and through the app's actual persistence pipeline:

     persistState() -> encryptState() -> localStore.set(STORAGE_KEY)
     reload -> autoInitApp() -> localStore.get -> decryptState()
            -> restorePersistableState()

   autoInitApp() deliberately swallows decrypt errors ("starting fresh"), so a
   broken decryptState would NOT crash the page — it would silently drop the
   user's data. That is why the check that matters most here is the last one:
   a marker message written before the reload must be present AFTER it.

   Check "bridge-identity" is patch-specific: it asserts window.encryptState /
   window.decryptState ARE the exports of modules/security.mjs. It is expected
   to FAIL on the pre-extraction tree (the functions lived in the classic
   script) and PASS after. Every other check is behavior-only and must pass
   on BOTH sides of the extraction — that is the behavior-equivalence proof.
   ========================================================================== */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_DIR = new URL('../frontend', import.meta.url).pathname;
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const STATIC_PORT = 8922;

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const staticServer = createServer(async (req, res) => {
  try {
    const urlPath = req.url === '/' ? HTML_FILE : decodeURIComponent(req.url.split('?')[0].slice(1));
    const filePath = path.join(FRONTEND_DIR, urlPath);
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    res.writeHead(404);
    res.end(String(e));
  }
});
await new Promise((r) => staticServer.listen(STATIC_PORT, r));
log('static-server-boot', true, `serving ${HTML_FILE} on :${STATIC_PORT}`);

const pageErrors = [];
const consoleErrors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: 'networkidle' });
// autoInitApp() is async and kicked off from main.js — wait until the device
// key is imported (encryptionKey is a classic-script `let`, reachable here by
// bare name because page.evaluate runs in the global scope).
await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
log('page-load-and-init', pageErrors.length === 0, `pageErrors=${pageErrors.length}`);

// ---- 1. the functions are reachable exactly where the monolith calls them ----
const present = await page.evaluate(() => ({
  enc: typeof window.encryptState,
  dec: typeof window.decryptState,
  encAsync: window.encryptState?.constructor?.name,
  decAsync: window.decryptState?.constructor?.name,
}));
log('functions-present-on-window',
  present.enc === 'function' && present.dec === 'function' &&
  present.encAsync === 'AsyncFunction' && present.decAsync === 'AsyncFunction',
  JSON.stringify(present));

// ---- 2. patch-specific: served by the module via the bridge ----
const bridge = await page.evaluate(async () => {
  try {
    const mod = await import('/modules/security.mjs');
    return {
      exported: typeof mod.encryptState === 'function' && typeof mod.decryptState === 'function',
      sameEnc: mod.encryptState === window.encryptState,
      sameDec: mod.decryptState === window.decryptState,
    };
  } catch (e) { return { error: String(e) }; }
});
log('bridge-identity', bridge.exported === true && bridge.sameEnc === true && bridge.sameDec === true,
  `(patch-specific; expected FAIL pre-extraction) ${JSON.stringify(bridge)}`);

// ---- 3. direct behavior, real Web Crypto in real Chromium ----
const direct = await page.evaluate(async () => {
  const out = {};
  try {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const otherKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const obj = { اسم: 'نكسس', n: 42, nested: { a: [1, 2, { b: null }], t: true }, emoji: '🔒', s: "q'\"<>&" };

  const payload = await encryptState(obj, key);
  out.shape = Object.keys(payload).sort().join(',');
  out.ivBytes = atob(payload.iv).length;
  out.b64ok = /^[A-Za-z0-9+/]+=*$/.test(payload.iv) && /^[A-Za-z0-9+/]+=*$/.test(payload.data);
  out.plainHidden = !atob(payload.data).includes('نكسس') && !payload.data.includes('42');
  out.roundTrip = JSON.stringify(await decryptState(payload, key)) === JSON.stringify(obj);

  const payload2 = await encryptState(obj, key);
  out.freshIv = payload.iv !== payload2.iv && payload.data !== payload2.data;

  // wrong key
  try { await decryptState(payload, otherKey); out.wrongKey = 'ACCEPTED'; }
  catch (e) { out.wrongKey = 'rejected:' + e.name; }

  // tampered ciphertext (flip one byte -> GCM auth tag must fail)
  const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
  bytes[0] ^= 0xff;
  const tampered = { iv: payload.iv, data: btoa(String.fromCharCode(...bytes)) };
  try { await decryptState(tampered, key); out.tampered = 'ACCEPTED'; }
  catch (e) { out.tampered = 'rejected:' + e.name; }

  // tampered IV
  const ivBytes = Uint8Array.from(atob(payload.iv), (c) => c.charCodeAt(0));
  ivBytes[0] ^= 0x01;
  try { await decryptState({ iv: btoa(String.fromCharCode(...ivBytes)), data: payload.data }, key); out.tamperedIv = 'ACCEPTED'; }
  catch (e) { out.tamperedIv = 'rejected:' + e.name; }

  // malformed payloads
  for (const [label, bad] of [['missingIv', { data: payload.data }], ['missingData', { iv: payload.iv }], ['notBase64', { iv: '***', data: '***' }], ['null', null]]) {
    try { await decryptState(bad, key); out[label] = 'ACCEPTED'; }
    catch (e) { out[label] = 'rejected:' + e.name; }
  }
  } catch (e) { out.crashed = String(e); }
  return out;
});
if (direct.crashed) log('direct-behavior-block-ran', false, direct.crashed.slice(0, 160));
log('encrypt-shape-and-fresh-iv', direct.shape === 'data,iv' && direct.ivBytes === 12 && direct.b64ok && direct.freshIv,
  `keys=${direct.shape} ivBytes=${direct.ivBytes} b64=${direct.b64ok} freshIv=${direct.freshIv}`);
log('ciphertext-hides-plaintext', direct.plainHidden === true);
log('round-trip-exact', direct.roundTrip === true, 'Arabic keys/values, emoji, nested arrays, null, quotes');
log('wrong-key-rejected', String(direct.wrongKey).startsWith('rejected'), direct.wrongKey);
log('tampered-ciphertext-rejected', String(direct.tampered).startsWith('rejected'), direct.tampered);
log('tampered-iv-rejected', String(direct.tamperedIv).startsWith('rejected'), direct.tamperedIv);
log('malformed-payloads-rejected',
  ['missingIv', 'missingData', 'notBase64', 'null'].every((k) => String(direct[k]).startsWith('rejected')),
  JSON.stringify({ missingIv: direct.missingIv, missingData: direct.missingData, notBase64: direct.notBase64, null: direct.null }));

// ---- 4. the real pipeline: persist -> reload -> restore ----
const MARKER = 'CORE-SEED-MARKER-' + Date.now() + '-رسالة-اختبار';
const persistRun = await page.evaluate(async (marker) => {
  try {
    messages.push({ role: 'user', agentId: null, agentName: 'أنت', content: marker, type: 'text' });
    await persistState();
    return 'ok';
  } catch (e) { return 'crashed: ' + e; }
}, MARKER);
log('persist-call-completed', persistRun === 'ok', persistRun);

const stored = await page.evaluate(async () => {
  try {
    const res = await localStore.get(STORAGE_KEY);
    return res ? res.value : null;
  } catch (e) { return null; } // nothing persisted -> reported as a FAIL below, not a crash
});
let storedShape = null;
try { storedShape = Object.keys(JSON.parse(stored)).sort().join(','); } catch { /* leave null */ }
log('persisted-blob-is-encrypted-envelope',
  stored !== null && storedShape === 'data,iv' && !stored.includes(MARKER) && !stored.includes('رسالة'),
  `shape=${storedShape} plaintextLeak=${stored ? stored.includes(MARKER) : 'n/a'}`);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
let restored = false;
try {
  await page.waitForFunction((m) => messages.some((x) => x && x.content === m), MARKER, { timeout: 15000 });
  restored = true;
} catch { restored = false; }
log('state-restored-after-reload', restored,
  'marker written pre-reload is present post-reload (decryptState + restorePersistableState via real autoInitApp)');

const decErr = consoleErrors.filter((t) => /Decrypt error|persist failed|Key import error/.test(t));
log('no-decrypt-or-persist-errors', decErr.length === 0, decErr.join(' | ').slice(0, 200));
log('no-page-errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));

await browser.close();
staticServer.close();

const failed = results.filter((r) => !r.ok);
console.log('\n=== SUMMARY ===');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(', '));
process.exit(failed.length ? 1 : 0);
