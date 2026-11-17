/* ==========================================================================
   e2e/release-v1-b1-offline-sw-flows.mjs — Release V1, B1: offline boot through a REAL service worker.
   Criteria written first (frozen): baseline/evidence/release-v1-b1-acceptance-criteria.md

   Real Chromium, real frontend files, real `frontend/sw.js`, a real local HTTP server (127.0.0.1, random port). Nothing is routed
   through page.route / context.route and the service worker is NOT blocked. "Offline" = the HTTP server is really closed.

   Check kinds (tag in the name):  VALID  validity/controls — any red ⇒ verdict INVALID
                                   PRES   behavior that must hold with and without the SW
                                   PS     patch-specific (the service worker) — red on a tree without sw.js
   Final line:  B1-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED.

   NEXUS_FRONTEND_DIR points at another frontend dir; NEXUS_B1_RESULTS overrides the results JSON (default: os.tmpdir()).
   The result JSON is deterministic (no timings / timestamps / ports).
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_B1_RESULTS || path.join(os.tmpdir(), 'release-v1-b1-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const pres = (n, ok, d) => rec('PRES', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);

/* ---- independent resolver: which same-origin JS files does the real boot need? (parses HTML + static imports) ---- */
async function expectedBootJs() {
  const html = await readFile(path.join(FRONTEND_DIR, HTML_FILE), 'utf8');
  // module scripts (+ their static import graph) AND, since 2026-11-17, the externalised classic same-origin scripts (app.js, ui-glow.js)
  const queue = [...html.matchAll(/<script[^>]*\bsrc=["'](?!https?:)([^"']+)["'][^>]*>/g)].map((m) => path.posix.normalize(m[1]));
  const seen = new Set();
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    const txt = await readFile(path.join(FRONTEND_DIR, f), 'utf8');
    for (const m of txt.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1] || m[2])));
    }
  }
  return [...seen].map((f) => '/' + f).sort();
}

/* ---- a real HTTP server; `swTransform` lets the CONTROL serve a deliberately broken sw.js ---- */
async function startServer({ swTransform } = {}) {
  const hits = { echo: 0, other: 0 };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
    if (u.pathname === '/api/echo') { hits.echo++; return send(200, 'application/json', JSON.stringify({ n: hits.echo })); }
    if (u.pathname === '/other.txt') { hits.other++; return send(200, 'text/plain', 'other ' + hits.other); }
    if (u.pathname === '/blank.html') {
      return send(200, 'text/html', '<!doctype html><title>blank</title><script>' +
        '(async()=>{await caches.open("nexus-shell-v0");await caches.open("other-cache");document.title="seeded";})()</script>');
    }
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    const abs = path.resolve(FRONTEND_DIR, rel);
    if (!abs.startsWith(FRONTEND_DIR + path.sep)) return send(403, 'text/plain', 'no');
    try {
      let body = await readFile(abs);
      if (rel === 'sw.js' && swTransform) body = Buffer.from(swTransform(body.toString('utf8')));
      send(200, MIME[path.extname(rel)] || 'application/octet-stream', body);
    } catch { send(404, 'text/plain', 'not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  return { origin, hits, server, closeNow: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) };
}

async function dumpCaches(page) {
  return page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      out[k] = (await c.keys()).map((r) => new URL(r.url).pathname).sort();
    }
    return out;
  });
}
async function waitInit(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}

/* One full scenario: online boot → SW takes control → probes → server closed → offline reload. Returns a deterministic outcome. */
async function scenario(browser, opts = {}) {
  const srv = await startServer(opts);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  const onlineJs = new Set();
  let phase = 'online';
  const offlineResp = new Map(); // path -> fromServiceWorker
  const offlineFailed = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (phase === 'online' && u.origin === srv.origin && /\.m?js$/.test(u.pathname)) onlineJs.add(u.pathname);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (phase === 'offline' && u.origin === srv.origin) offlineResp.set(u.pathname, r.fromServiceWorker());
  });
  page.on('requestfailed', (r) => {
    const u = new URL(r.url());
    if (phase === 'offline' && u.origin === srv.origin) offlineFailed.push(u.pathname);
  });
  const o = { onlineInit: false, controlled: false, cachesAfterBoot: {}, cachesAfterProbes: {}, apiCountsOnline: null, otherOnline: null,
    offlineReallyOffline: false, navOk: false, offlineInit: false, bridged: false, accessor: false, offlineFromSw: {}, offlineFailed: [],
    pageErrors: [], onlineJs: [] };
  try {
    await page.goto(srv.origin + '/', { waitUntil: 'load' });
    o.onlineInit = await waitInit(page);
    // SW registration happens in main.js startup; wait (bounded) for it to become active and to control the page.
    try {
      await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 8000))]));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
      o.controlled = true;
    } catch { o.controlled = false; }
    o.cachesAfterBoot = await dumpCaches(page);
    // probes while online and controlled: API-like and arbitrary same-origin GETs must NOT be answered from cache
    o.apiCountsOnline = await page.evaluate(async () => {
      const a = await (await fetch('/api/echo')).json(); const b = await (await fetch('/api/echo')).json();
      return [a.n, b.n];
    });
    o.otherOnline = await page.evaluate(async () => { const a = await (await fetch('/other.txt')).text(); const b = await (await fetch('/other.txt')).text(); return [a, b]; });
    o.cachesAfterProbes = await dumpCaches(page);
    o.onlineJs = [...onlineJs].sort();
    // ---- go really offline ----
    await srv.closeNow();
    // the reality probe runs BEFORE the offline observation window opens (its own failed request must not count in P2b)
    o.offlineReallyOffline = await page.evaluate(async (origin) => {
      try { await fetch(origin + '/zz-not-cached', { cache: 'no-store' }); return false; } catch { return true; }
    }, srv.origin);
    phase = 'offline';
    try { await page.reload({ waitUntil: 'load', timeout: 20000 }); o.navOk = true; } catch { o.navOk = false; }
    if (o.navOk) {
      o.offlineInit = await waitInit(page);
      o.bridged = await page.evaluate(() => typeof window.encryptState === 'function' && typeof window.getUILang === 'function');
      o.accessor = await page.evaluate(() => { const d = Object.getOwnPropertyDescriptor(window, 'agentOrder'); return !!(d && d.get && d.set); });
    }
    o.offlineFromSw = Object.fromEntries([...offlineResp.entries()].filter(([p]) => /\.m?js$/.test(p)).sort(([a], [b]) => a.localeCompare(b)));
    o.offlineFailed = [...new Set(offlineFailed)].sort();
  } finally {
    o.pageErrors = pageErrors;
    await ctx.close();
    await srv.closeNow().catch(() => {});
  }
  return o;
}

let browser = null;
let chromiumVersion = '?';
const outcomeSummary = {};
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  const expected = await expectedBootJs();
  const swPath = path.join(FRONTEND_DIR, 'sw.js');
  let swText = null;
  try { swText = await readFile(swPath, 'utf8'); } catch { swText = null; }
  console.log('expected boot JS (independent resolver):', expected.join(', '));

  // ---- scenario A (twice, for determinism) and CONTROL C (sw.js without state.mjs) ----
  const A = await scenario(browser);
  const A2 = await scenario(browser);
  let transformApplied = false;
  const C = await scenario(browser, { swTransform: (s) => { const t = s.split('\n').filter((l) => !/modules\/state\.mjs/.test(l)).join('\n'); transformApplied = t !== s; return t; } });

  // ---- scenario D: old caches present BEFORE the SW is installed ----
  let D = { cachesAfter: null, controlled: false };
  {
    const srv = await startServer();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(srv.origin + '/blank.html', { waitUntil: 'load' });
      await page.waitForFunction(() => document.title === 'seeded', null, { timeout: 8000 });
      await page.goto(srv.origin + '/', { waitUntil: 'load' });
      await waitInit(page);
      try {
        await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 8000))]));
        await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 8000 });
        D.controlled = true;
      } catch { D.controlled = false; }
      await page.waitForTimeout(500); // activate-time cleanup finishes before `ready` resolves in practice; small margin
      D.cachesAfter = await dumpCaches(page);
    } finally { await ctx.close(); await srv.closeNow().catch(() => {}); }
  }

  // ===================== VALID =====================
  valid('V2-resolver-yields-8-js-files-incl-state-mjs-app-js', expected.length === 8 && expected.includes('/app.js') && expected.includes('/modules/state.mjs') && expected.includes('/main.js'), expected.join(','));
  valid('V2b-resolver-equals-observed-online-js-requests', JSON.stringify(expected) === JSON.stringify(A.onlineJs), 'observed=' + A.onlineJs.join(','));
  valid('V3-offline-is-real-server-closed-fetch-fails', A.offlineReallyOffline && A2.offlineReallyOffline && C.offlineReallyOffline);
  valid('V4a-control-transform-applied-sw-without-state-mjs', swText === null ? true : transformApplied, swText === null ? 'no sw.js in tree (PRE)' : `applied=${transformApplied}`);
  valid('V5-determinism-two-runs-identical', JSON.stringify(A) === JSON.stringify(A2));
  valid('V6-online-boot-initialises-with-and-without-sw', A.onlineInit && A2.onlineInit && C.onlineInit);

  // ===================== PRES =====================
  pres('R1-no-pageerror-online-and-offline', A.pageErrors.length === 0 && C.pageErrors.length === 0, JSON.stringify(A.pageErrors.concat(C.pageErrors)).slice(0, 200));

  // ===================== PS =====================
  ps('P0-sw-registered-active-and-controlling', A.controlled === true);
  const cacheNames = Object.keys(A.cachesAfterBoot).filter((k) => /^nexus-shell-/.test(k));
  const cached = cacheNames.length === 1 ? A.cachesAfterBoot[cacheNames[0]] : [];
  ps('P1-one-versioned-cache-holds-every-expected-js', cacheNames.length === 1 && expected.every((p) => cached.includes(p)), `caches=${cacheNames.join(',')} cached=${cached.join(',')}`);
  ps('P1b-document-cached-for-offline-navigation', cached.includes('/') || cached.includes('/' + HTML_FILE), cached.join(','));
  ps('P2-offline-reload-boots-app', A.navOk && A.offlineInit && A.bridged && A.accessor, `nav=${A.navOk} init=${A.offlineInit} bridged=${A.bridged} accessor=${A.accessor}`);
  ps('P2b-no-failed-same-origin-request-offline', A.navOk && A.offlineFailed.length === 0, A.offlineFailed.join(','));
  ps('P3-every-boot-js-served-by-sw-offline', expected.every((p) => A.offlineFromSw[p] === true), JSON.stringify(A.offlineFromSw));
  ps('P4-api-like-get-not-cached', A.apiCountsOnline && A.apiCountsOnline[0] === 1 && A.apiCountsOnline[1] === 2 && !JSON.stringify(A.cachesAfterProbes).includes('/api/'), JSON.stringify(A.apiCountsOnline));
  ps('P5-non-allowlisted-path-not-cached', A.otherOnline && A.otherOnline[0] !== A.otherOnline[1] && !JSON.stringify(A.cachesAfterProbes).includes('other.txt'), JSON.stringify(A.otherOnline));
  const dNames = D.cachesAfter ? Object.keys(D.cachesAfter) : [];
  ps('P6-activate-removes-old-shell-cache-keeps-foreign-cache', D.controlled && !dNames.includes('nexus-shell-v0') && dNames.includes('other-cache') && dNames.filter((k) => /^nexus-shell-/.test(k)).length === 1, dNames.join(','));
  ps('P7-sw-source-has-no-web-storage-or-header-persistence', swText !== null && !/localStorage|sessionStorage|indexedDB|Authorization/i.test(swText), swText === null ? 'no sw.js' : 'static scan');
  // Control: the SAME flow with an sw.js lacking state.mjs must FAIL offline (shows P2 can fail), and it must fail because of the missing file.
  const cBroke = C.navOk === false || C.offlineInit === false || C.offlineFailed.includes('/modules/state.mjs') || C.pageErrors.length > 0;
  ps('P8-control-without-state-mjs-breaks-offline-boot-and-the-real-sw-does-not', swText !== null && cBroke && A.offlineInit === true, `control: nav=${C.navOk} init=${C.offlineInit} failed=${C.offlineFailed.join(',')} errs=${C.pageErrors.length}`);

  Object.assign(outcomeSummary, { expected, A, C, D });
} catch (e) {
  console.log('SCRIPT ERROR:', e && e.stack || e);
  rec('VALID', 'script-completed-without-exception', false, String(e).slice(0, 200));
} finally {
  if (browser) await browser.close();
}

const count = (k) => { const c = checks.filter((x) => x.kind === k); return `${c.filter((x) => x.ok).length}/${c.length}`; };
const invalid = checks.some((c) => c.kind === 'VALID' && !c.ok);
const rejected = checks.some((c) => (c.kind === 'PS' || c.kind === 'PRES') && !c.ok);
const verdict = invalid ? 'INVALID' : rejected ? 'REJECTED' : 'ACCEPTED';
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, chromiumVersion, checks, outcome: outcomeSummary }, null, 2));
console.log(`\nVALID ${count('VALID')}  PRES ${count('PRES')}  PS ${count('PS')}  chromium=${chromiumVersion}  frontend=${path.relative(process.cwd(), FRONTEND_DIR) || '.'}`);
console.log(`B1-VERDICT = ${verdict}`);
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
