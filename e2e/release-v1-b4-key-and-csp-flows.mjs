/* ==========================================================================
   e2e/release-v1-b4-key-and-csp-flows.mjs — Release V1, B4 (frontend half): gateway key = memory only, CSP actually enforced.
   Criteria written first (frozen): baseline/evidence/release-v1-b4-acceptance-criteria.md  (items F1–F8)

   Real Chromium, the real frontend files served by a real local HTTP server (127.0.0.1, random port). Nothing is routed through
   page.route. The server ALSO records the requests the page sends to /v2/models and /api/sync — it is a RECORDER that proves what
   the client puts on the wire; it answers 404/503 and is NOT used to claim any live-backend integration success.

   Check kinds (tag in the name):  VALID  validity/controls (patch-independent) — any red ⇒ verdict INVALID
                                   PS     patch-specific — expected red on a tree without the B4 frontend change
   Final line:  B4FE-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED.
   NEXUS_FRONTEND_DIR points at another frontend dir (used for the PRE run); NEXUS_B4FE_RESULTS overrides the results JSON.
   The result JSON is deterministic (no timings / ports / timestamps).
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_B4FE_RESULTS || path.join(os.tmpdir(), 'release-v1-b4fe-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const SECRET = 'LAN-test-key-zq7XkP2mWv9sRt4Y-E2E';
const LEGACY_SECRET = 'LEGACY-persisted-key-9f8e7d6c5b4a';
const MARKER = 'SCANNER-SANITY-MARKER-31415926';

const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);

async function startServer() {
  const seen = []; // {path, auth}
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/v2/models' || u.pathname === '/api/sync') {
      seen.push({ path: u.pathname, auth: req.headers.authorization ?? null });
      return send(503, 'application/json', '{"error":{"code":"recorder"}}');
    }
    if (u.pathname === '/blank.html') return send(200, 'text/html', '<!doctype html><title>blank</title>');
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    const abs = path.resolve(FRONTEND_DIR, rel);
    if (!abs.startsWith(FRONTEND_DIR + path.sep)) return send(403, 'text/plain', 'no');
    try { send(200, MIME[path.extname(rel)] || 'application/octet-stream', await readFile(abs)); }
    catch { send(404, 'text/plain', 'not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { origin: 'http://127.0.0.1:' + server.address().port, seen, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

/* Every place the page could persist a secret: both web storages, cookies, IndexedDB values, Cache Storage (bodies + urls). */
async function storageDump(page) {
  return page.evaluate(async () => {
    const out = { local: {}, session: {}, cookie: document.cookie, idb: [], caches: [] };
    for (let i = 0; i < localStorage.length; i++) out.local[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    for (let i = 0; i < sessionStorage.length; i++) out.session[sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i));
    try {
      const dbs = (indexedDB.databases ? await indexedDB.databases() : []);
      for (const info of dbs) {
        await new Promise((resolve) => {
          const rq = indexedDB.open(info.name);
          rq.onerror = () => resolve();
          rq.onsuccess = () => {
            const db = rq.result;
            const names = [...db.objectStoreNames];
            if (!names.length) { db.close(); return resolve(); }
            const tx = db.transaction(names, 'readonly');
            let pending = names.length;
            for (const n of names) {
              const g = tx.objectStore(n).getAll();
              g.onsuccess = () => { try { out.idb.push(info.name + '/' + n + ':' + JSON.stringify(g.result)); } catch { out.idb.push(info.name + '/' + n + ':<unserializable>'); } if (--pending === 0) { db.close(); resolve(); } };
              g.onerror = () => { if (--pending === 0) { db.close(); resolve(); } };
            }
          };
        });
      }
    } catch { /* ignore */ }
    try {
      for (const k of await caches.keys()) {
        const c = await caches.open(k);
        for (const r of await c.keys()) { const resp = await c.match(r); out.caches.push(r.url + '\n' + (await resp.clone().text()).slice(0, 2_000_000)); }
      }
    } catch { /* ignore */ }
    return out;
  });
}
const dumpText = (d) => JSON.stringify(d);
async function waitInit(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}
const CSP_HOOK = () => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push({ d: e.violatedDirective, u: e.blockedURI, disp: e.disposition }));
};

/* ---------------- run ---------------- */
const html = await readFile(path.join(FRONTEND_DIR, HTML_FILE), 'utf8');
const browser = await chromium.launch();
const srv = await startServer();
try {
  /* ===== S0: scanner sanity (VALID) — the secret scan is able to see a planted value in every store it covers ===== */
  {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(srv.origin + '/blank.html');
    await page.evaluate(async (m) => {
      localStorage.setItem('m_ls', m); sessionStorage.setItem('m_ss', m);
      const c = await caches.open('m-cache'); await c.put('/m', new Response(m));
      await new Promise((res) => { const rq = indexedDB.open('m-db', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('s'); rq.onsuccess = () => { const tx = rq.result.transaction('s', 'readwrite'); tx.objectStore('s').put(m, 'k'); tx.oncomplete = () => { rq.result.close(); res(); }; }; });
    }, MARKER);
    const d = await storageDump(page);
    valid('V1 scanner sees a planted marker in localStorage', JSON.stringify(d.local).includes(MARKER));
    valid('V2 scanner sees a planted marker in sessionStorage', JSON.stringify(d.session).includes(MARKER));
    valid('V3 scanner sees a planted marker in IndexedDB', JSON.stringify(d.idb).includes(MARKER));
    valid('V4 scanner sees a planted marker in Cache Storage', JSON.stringify(d.caches).includes(MARKER));
    await ctx.close();
  }

  /* ===== S1: key lifecycle through the real UI ===== */
  const ctx = await browser.newContext();
  await ctx.addInitScript(CSP_HOOK);
  const page = await ctx.newPage();
  const consoleTexts = []; const pageErrors = [];
  page.on('console', (m) => consoleTexts.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // seed a legacy persisted key (what an older version left behind) in BOTH storages, on the same origin, before the app boots
  await page.goto(srv.origin + '/blank.html');
  await page.evaluate((k) => { localStorage.setItem('nexus_gateway_key', k); sessionStorage.setItem('nexus_gateway_key', k); }, LEGACY_SECRET);
  const seeded = await page.evaluate(() => [localStorage.getItem('nexus_gateway_key'), sessionStorage.getItem('nexus_gateway_key')]);
  valid('V5 legacy key really seeded in both storages before boot', seeded[0] && seeded[1]);

  await page.goto(srv.origin + '/', { waitUntil: 'load' });
  const init1 = await waitInit(page);
  valid('V6 app boots (autoInitApp finished) with the CSP in place', init1);
  const afterBoot = await page.evaluate(() => [localStorage.getItem('nexus_gateway_key'), sessionStorage.getItem('nexus_gateway_key'), typeof getGatewayKey === 'function' ? getGatewayKey() : 'NO-FN']);
  ps('F3 legacy persisted key is purged from localStorage AND sessionStorage at boot', afterBoot[0] === null && afterBoot[1] === null, `local=${afterBoot[0] === null ? 'removed' : 'still-there'} session=${afterBoot[1] === null ? 'removed' : 'still-there'}`);
  ps('F3b legacy key is NOT adopted into memory', afterBoot[2] === '', `getGatewayKey()=${JSON.stringify(afterBoot[2] === '' ? '' : '<non-empty>')}`);

  // enter backend URL + key through the real settings modal
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', srv.origin);
  await page.fill('#gatewayKeyInput', SECRET);
  await page.click('button[onclick="saveBackendUrl()"]');
  await page.evaluate(() => persistState()); // also exercise the app's own persistence path after the key exists
  srv.seen.length = 0;
  await page.evaluate(() => syncProviderCatalogFromBackend()); // real app function that sends syncAuthHeaders() to /v2/models
  const w1 = srv.seen.filter((r) => r.path === '/v2/models');
  valid('V7 the app really sent a /v2/models request after saving settings', w1.length >= 1);
  ps('F2 the key is attached as Authorization: Bearer on the wire while the page lives (in-memory path works)', w1.length >= 1 && w1.every((r) => r.auth === 'Bearer ' + SECRET), `requests=${w1.length}`);

  const dump1 = await storageDump(page);
  const t1 = dumpText(dump1);
  ps('F1a the key is in neither localStorage nor sessionStorage (values scanned)', !JSON.stringify(dump1.local).includes(SECRET) && !JSON.stringify(dump1.session).includes(SECRET));
  ps('F1b no storage entry is named like a gateway key', ![...Object.keys(dump1.local), ...Object.keys(dump1.session)].some((k) => /gateway/i.test(k)), `local=${Object.keys(dump1.local).filter((k) => /gateway/i.test(k)).join(',') || '-'}`);
  ps('F1c the key is in no IndexedDB / Cache Storage / cookie either', !t1.includes(SECRET) && !dump1.cookie.includes(SECRET));
  const snap = await page.evaluate(() => (typeof snapshotPersistableState === 'function') ? JSON.stringify(snapshotPersistableState()) : null);
  ps('F5a persistable state snapshot (what is encrypted/synced) does not contain the key', snap !== null && !snap.includes(SECRET), snap === null ? 'snapshotPersistableState not reachable' : null);
  ps('F5b no console message and no pageerror contains the key or the legacy key', ![...consoleTexts, ...pageErrors].some((t) => t.includes(SECRET) || t.includes(LEGACY_SECRET)), `console=${consoleTexts.length}`);

  // reload: memory is gone
  srv.seen.length = 0;
  await page.reload({ waitUntil: 'load' });
  const init2 = await waitInit(page);
  valid('V8 app boots again after reload', init2);
  const keyAfterReload = await page.evaluate(() => getGatewayKey());
  ps('F4a after reload the key is gone from memory (no persistence anywhere)', keyAfterReload === '');
  await page.evaluate(() => syncProviderCatalogFromBackend());
  const w2 = srv.seen.filter((r) => r.path === '/v2/models');
  valid('V9 the stored backend URL still triggers a request after reload', w2.length >= 1);
  ps('F4b after reload requests carry NO Authorization header', w2.length >= 1 && w2.every((r) => r.auth === null), `requests=${w2.length}`);
  ps('F5c still no key in console after reload', ![...consoleTexts, ...pageErrors].some((t) => t.includes(SECRET)));

  /* ===== S2: CSP ===== */
  const metaIdx = html.indexOf('http-equiv="Content-Security-Policy"');
  const firstScriptIdx = html.search(/<script[\s>]/i);
  ps('F6a a CSP <meta http-equiv> exists and precedes every <script>', metaIdx > -1 && metaIdx < firstScriptIdx);
  const policy = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]*)"/) || [])[1] || '';
  const dir = (n) => ((policy.split(';').map((s) => s.trim()).find((s) => s.startsWith(n + ' ')) || '').slice(n.length + 1).split(/\s+/).filter(Boolean));
  const has = (n, v) => dir(n).includes(v);
  ps('F6b policy: default-src self; object-src none; base-uri self; form-action self; frame-src none',
    has('default-src', "'self'") && has('object-src', "'none'") && has('base-uri', "'self'") && has('form-action', "'self'") && has('frame-src', "'none'"), policy ? null : 'no policy');
  ps('F6c policy: script-src is exactly self + unsafe-inline + the cdnjs origin (no wildcard, no http:, no data:)',
    JSON.stringify(dir('script-src').sort()) === JSON.stringify(["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'].sort()), dir('script-src').join(' '));
  ps('F6d policy: no "unsafe-eval", img/manifest/worker/connect directives present', !/unsafe-eval/.test(policy) && dir('img-src').length > 0 && has('manifest-src', 'data:') && dir('worker-src').length > 0 && dir('connect-src').length > 0);

  // exercise the app a bit more, then count violations (F7)
  await page.evaluate(() => openSettingsPanel());
  await page.evaluate(() => closeModal('settingsModal'));
  await page.evaluate(() => loadScriptOnce(LIB_URLS.qrcode).catch(() => 'net-fail-is-ok')); // allowed origin: may fail by NETWORK, must not fail by CSP
  await page.waitForTimeout(500);
  const viol = await page.evaluate(() => window.__csp);
  const cspConsole = consoleTexts.filter((t) => /Content Security Policy|violates the following/i.test(t));
  ps('F7 zero CSP violations (event + console) across boot, settings, reload and the allowed cdnjs load; zero pageerrors', viol.length === 0 && cspConsole.length === 0 && pageErrors.length === 0, `violations=${viol.length} console=${cspConsole.length} pageerrors=${pageErrors.length}`);

  // F8 negative control: the policy really blocks foreign script / object / frame / base
  await page.evaluate((o) => {
    window.__csp.length = 0;
    const s = document.createElement('script'); s.src = 'https://evil.example/x.js'; s.onerror = () => {}; document.head.appendChild(s);
    const ob = document.createElement('object'); ob.data = 'https://evil.example/o.swf'; document.body.appendChild(ob);
    const f = document.createElement('iframe'); f.src = o + '/blank.html'; document.body.appendChild(f);
    const b = document.createElement('base'); b.href = 'https://evil.example/'; document.head.appendChild(b);
  }, srv.origin);
  await page.waitForTimeout(800);
  const v2 = await page.evaluate(() => window.__csp.map((v) => v.d));
  const dirs = new Set(v2.map((d) => d.replace(/-elem$/, '')));
  ps('F8a foreign <script src> is blocked (script-src violation observed)', dirs.has('script-src'), [...dirs].join(','));
  ps('F8b foreign <object> is blocked (object-src violation observed)', dirs.has('object-src'), [...dirs].join(','));
  ps('F8c <iframe> is blocked (frame-src violation observed)', dirs.has('frame-src'), [...dirs].join(','));
  ps('F8d <base href> to a foreign origin is blocked (base-uri violation observed)', dirs.has('base-uri'), [...dirs].join(','));
  await ctx.close();
} finally {
  await browser.close();
  await srv.close();
}

const vFail = checks.filter((c) => c.kind === 'VALID' && !c.ok);
const pFail = checks.filter((c) => c.kind === 'PS' && !c.ok);
const verdict = vFail.length ? 'INVALID' : pFail.length ? 'REJECTED' : 'ACCEPTED';
console.log(`SUMMARY VALID ${checks.filter((c) => c.kind === 'VALID' && c.ok).length}/${checks.filter((c) => c.kind === 'VALID').length}  PS ${checks.filter((c) => c.kind === 'PS' && c.ok).length}/${checks.filter((c) => c.kind === 'PS').length}`);
console.log(`B4FE-VERDICT = ${verdict}`);
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, checks: checks.map((c) => ({ kind: c.kind, name: c.name, ok: c.ok })) }, null, 2));
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
