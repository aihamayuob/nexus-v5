/* ==========================================================================
   e2e/phase2-core-slice6-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9
   "core", TARGET SLICE 6: acceptance tests for handling I-1 via option O2
   ("delay updateOnlineStatus() until autoInitApp() has settled").
   Criteria: baseline/evidence/phase2-core-slice6-acceptance-criteria.md (written BEFORE any
   production change). Real HTML + real modules + real autoInitApp / persistState /
   localStore / encryptState in real Chromium; no mocks of app logic.

   "Offline" = Chromium's own network emulation (BrowserContext.setOffline). The page is
   served through context.route from https://nexus.test (secure context => crypto.subtle).
   Every offline boot PROVES navigator.onLine === false at document start and that the
   offline banner was applied (VALID checks); every blob boot PROVES the restore really ran.

   Check tags (printed and stored):
     VALID  measurement validity — must always pass, otherwise the run is INVALID.
     PRES   preserved behavior   — must pass BEFORE and AFTER the O2 patch.
     PS     patch-specific       — expected RED before the patch, GREEN after it.
   Verdict line:  S6-VERDICT = ACCEPTED | REJECTED | INVALID   (exit 0 iff ACCEPTED).
   Run on the unpatched tree it is expected to be REJECTED with only PS checks failing.

   Extra init-script hooks (test-side only; they never edit production files):
     gate     : the FIRST `localStore.get('nexus_device_key')` of the page waits for a test-controlled promise
                (holds autoInitApp open to create a deterministic "init window").
     failInit : `ExecutionCheckpoint.checkForResumable()` (an unguarded call in autoInitApp's tail, AFTER the
                restore) throws, so autoInitApp rejects.
   NEXUS_FRONTEND_DIR points the script at a scratch copy (used by the mutation script only).
   NEXUS_S6_RESULTS overrides the results JSON path.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S6_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-core-slice6-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const OFF = 'انقطع الاتصال';
const INJECT_MSG = 'S6-injected-autoInit-failure';
const REPEATS_PLAIN = 5;
const REPEATS_TRACED = 3;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };

const checks = [];
function check(tag, name, ok, detail) {
  checks.push({ tag, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}][${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}
const observed = [];
function observe(name, value, detail) {
  observed.push({ name, value, detail: detail ?? null });
  console.log(`[OBSERVED] ${name} = ${typeof value === 'string' ? value : JSON.stringify(value)}${detail ? ' — ' + detail : ''}`);
}

let browser = null;
const pageErrors = []; // { scenario, error } for non-injected scenarios

async function newContext() {
  const ctx = await browser.newContext(); // fresh context => fresh IndexedDB
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort();
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    try {
      const content = await readFile(path.join(FRONTEND_DIR, rel));
      await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
    } catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  return ctx;
}

/* ---- init scripts (serialised into the page; must be self-contained) ---- */
const PLAIN_INIT = () => {
  window.__onLineAtDocStart = navigator.onLine;
  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) => { window.__rejections.push(String((e.reason && e.reason.message) || e.reason)); });
};
const TRACED_INIT = (OFFLINE_ACTION) => {
  window.__onLineAtDocStart = navigator.onLine;
  window.__rejections = [];
  window.addEventListener('unhandledrejection', (e) => { window.__rejections.push(String((e.reason && e.reason.message) || e.reason)); });
  window.__tl = [];
  let seq = 0;
  const rec = (t, extra) => window.__tl.push(Object.assign({ seq: seq++, t }, extra));
  const origUnshift = Array.prototype.unshift;
  Array.prototype.unshift = function (...a) {
    if (a.length === 1 && a[0] && typeof a[0] === 'object' && a[0].action === OFFLINE_ACTION) rec('offline-entry-write', { onLine: navigator.onLine });
    return origUnshift.apply(this, a);
  };
  let core;
  Object.defineProperty(window, 'PersistableStateCore', {
    configurable: true,
    get() { return core; },
    set(v) {
      core = Object.assign({}, v, {
        restorePersistableState(registry, decrypted) {
          rec('restore-begin', { before: activityLog.map((x) => x.action) });
          const r = v.restorePersistableState(registry, decrypted);
          rec('restore-end', { after: activityLog.map((x) => x.action) });
          return r;
        },
      });
    },
  });
  try {
    if (navigator.serviceWorker) {
      const o = navigator.serviceWorker.register.bind(navigator.serviceWorker);
      navigator.serviceWorker.register = function (...a) { rec('sw-register'); return o(...a); };
    }
  } catch (e) { /* recorded as absence */ }
  new MutationObserver((ms) => {
    for (const m of ms) { const t = m.target; if (t && t.id === 'offlineBanner') rec('banner-style', { display: t.style.display }); }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] });
};
const EXTRA_INIT = (cfg) => {
  if (cfg.gate) {
    let rel; window.__gate = new Promise((r) => { rel = r; }); window.__releaseGate = () => rel();
    let ls;
    Object.defineProperty(window, 'localStore', {
      configurable: true,
      get() { return ls; },
      set(v) { ls = Object.assign({}, v, { async get(k) { if (k === 'nexus_device_key') await window.__gate; return v.get(k); } }); },
    });
  }
  if (cfg.failInit) {
    let ec;
    Object.defineProperty(window, 'ExecutionCheckpoint', {
      configurable: true,
      get() { return ec; },
      set(v) { ec = Object.create(v); ec.checkForResumable = function () { throw new Error(cfg.failInit); }; },
    });
  }
};

async function open(ctx, variant, tag) {
  if (variant === 'traced') await ctx.addInitScript(TRACED_INIT, OFF); else await ctx.addInitScript(PLAIN_INIT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push({ scenario: tag, error: String(e) }));
  return page;
}
async function waitInit(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; } catch { return false; }
}
async function waitRestored(page, m) {
  try { await page.waitForFunction((x) => Array.isArray(messages) && messages.some((y) => y && y.content === x), m, { timeout: 15000 }); return true; } catch { return false; }
}
const mkSeed = (mark) => [
  { ts: '2001-02-03T04:05:06.000Z', action: mark + '-act-1', detail: 'd1' },
  { ts: '2001-02-03T04:05:07.000Z', action: mark + '-act-2', detail: 'd2' },
];
async function seedBlob(page, mark, { omit = false, corrupt = false } = {}) {
  return page.evaluate(async ({ mark, seed, omit, corrupt }) => {
    try {
      if (corrupt) {
        await localStore.set(STORAGE_KEY, JSON.stringify({ iv: 'AAAAAAAAAAAAAAAA', data: 'AAAA' }));
        let threw = false;
        try { const res = await localStore.get(STORAGE_KEY); await decryptState(JSON.parse(res.value), encryptionKey); } catch { threw = true; }
        return { ok: true, corruptDecryptThrows: threw };
      }
      messages = [{ role: 'user', agentId: null, agentName: 'أنت', content: mark + '-msg', type: 'text' }];
      activityLog = seed;
      if (omit) {
        const snap = snapshotPersistableState(); delete snap.activityLog;
        await localStore.set(STORAGE_KEY, JSON.stringify(await encryptState(snap, encryptionKey)));
      } else { await persistState(); }
      const res = await localStore.get(STORAGE_KEY);
      const dec = await decryptState(JSON.parse(res.value), encryptionKey);
      return { ok: true, blobActivity: Array.isArray(dec.activityLog) ? dec.activityLog.map((x) => x.action) : null, blobMsgs: dec.messages.map((m) => m.content) };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, { mark, seed: mkSeed(mark), omit, corrupt });
}
const readState = (page) => page.evaluate((OFFA) => {
  try {
    const dom = document.getElementById('activityList');
    const sb = document.getElementById('sendBtn');
    return {
      onLineAtStart: window.__onLineAtDocStart, onLineNow: navigator.onLine,
      banner: document.getElementById('offlineBanner').style.display,
      sendDisabled: sb ? sb.disabled : null,
      activity: activityLog.map((x) => x.action), messages: messages.map((m) => m.content),
      domHasOffline: dom ? dom.innerText.includes(OFFA) : null,
      domEntryCount: dom ? dom.querySelectorAll('.log-item').length : null,
      rejections: window.__rejections || [], tl: window.__tl || null,
      keyNull: typeof encryptionKey !== 'undefined' && encryptionKey === null,
    };
  } catch (e) { return { error: String(e) }; }
}, OFF);
const durableActivity = (page) => page.evaluate(async () => {
  try {
    await persistState();
    const res = await localStore.get(STORAGE_KEY);
    const dec = await decryptState(JSON.parse(res.value), encryptionKey);
    return Array.isArray(dec.activityLog) ? dec.activityLog.map((x) => x.action) : null;
  } catch (e) { return { error: String(e) }; }
});
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const count = (arr, v) => (Array.isArray(arr) ? arr.filter((x) => x === v).length : -1);

/* One scenario = fresh context. boot: 'offline' | 'online'. noBlob: nothing persisted before the boot.
   extra: {gate?:true, failInit?:string} applied only to the boot document. during(page): runs after load, BEFORE the gate is released.
   post(page, ctx): runs after the state was read (post-boot transitions). */
async function scenario({ variant = 'plain', boot, tag, omit = false, corrupt = false, noBlob = false, extra = null, during = null, post = null, expectRestore = true }) {
  const mark = `S6-${tag}-${variant}-${boot}-${Date.now()}`;
  const ctx = await newContext();
  try {
    const page = await open(ctx, variant, extra && extra.failInit ? tag + '(injected)' : tag);
    let seeded = null;
    if (noBlob) {
      if (boot === 'offline') await ctx.setOffline(true);
      if (extra) await ctx.addInitScript(EXTRA_INIT, extra);
      await page.goto(ORIGIN + '/', { waitUntil: 'load' });
    } else {
      await page.goto(ORIGIN + '/', { waitUntil: 'load' });
      await waitInit(page);
      seeded = await seedBlob(page, mark, { omit, corrupt });
      if (boot === 'offline') await ctx.setOffline(true);
      if (extra) await ctx.addInitScript(EXTRA_INIT, extra);
      await page.reload({ waitUntil: 'load' });
    }
    let duringRes = null;
    if (during) { await page.waitForTimeout(600); duringRes = await during(page); }
    if (extra && extra.gate) await page.evaluate(() => window.__releaseGate());
    const inited = await waitInit(page);
    const restored = (noBlob || corrupt || !expectRestore) ? null : await waitRestored(page, mark + '-msg');
    await page.waitForTimeout(800);
    const st = await readState(page);
    // hasBlob MUST be read before durableActivity(): that call runs persistState() and would create a blob itself.
    const hasBlob = await page.evaluate(async () => { try { await localStore.get(STORAGE_KEY); return true; } catch { return false; } });
    const durable = await durableActivity(page);
    const postRes = post ? await post(page, ctx) : null;
    return { mark, seedActivity: mkSeed(mark).map((x) => x.action), seeded, inited, restored, st, durable, hasBlob, duringRes, postRes };
  } finally { await ctx.close(); }
}
const seedOk = (r) => r.seeded && r.seeded.ok && sameList(r.seeded.blobActivity, r.seedActivity);
const validOffline = (r) => r.inited && r.restored && r.st.onLineAtStart === false && r.st.banner === 'block' && sameList(r.st.messages, [r.mark + '-msg']);
const expectedTop = (r) => [OFF, ...r.seedActivity];

try {
  browser = await chromium.launch();
  const chromiumVersion = browser.version();
  console.log(`Chromium ${chromiumVersion}; FRONTEND_DIR=${FRONTEND_DIR}`);

  // ===== AC-1: offline boot + decryptable blob — plain x5 =====
  const plain = [];
  for (let i = 0; i < REPEATS_PLAIN; i++) plain.push(await scenario({ boot: 'offline', tag: 'B' + i }));
  check('VALID', 'AC1-plain-offline-boots-valid-and-seed-persisted', plain.every((r) => validOffline(r) && seedOk(r)),
    plain.map((r) => `inited=${r.inited} restored=${r.restored} onLineAtStart=${r.st.onLineAtStart} banner=${r.st.banner}`).join(' | '));
  const b0 = plain[0];
  check('PS', 'AC1-final-activityLog=[offline-entry,seed-1,seed-2]-exactly-in-all-5-runs', plain.every((r) => sameList(r.st.activity, expectedTop(r))), `run0=${JSON.stringify(b0.st.activity)}`);
  check('PS', 'AC1-DOM-activity-panel-matches-memory (entry visible, same item count)', plain.every((r) => r.st.domHasOffline === true && r.st.domEntryCount === r.st.activity.length), `dom=${b0.st.domEntryCount} mem=${b0.st.activity.length} domHasOffline=${b0.st.domHasOffline}`);
  check('PS', 'AC1-next-persistState-persists-the-offline-entry-on-top-of-seed', plain.every((r) => sameList(r.durable, expectedTop(r))), `durable0=${JSON.stringify(b0.durable)}`);

  // ===== AC-1 / AC-7: traced x3 — ordering evidence =====
  const traced = [];
  for (let i = 0; i < REPEATS_TRACED; i++) traced.push(await scenario({ variant: 'traced', boot: 'offline', tag: 'T' + i }));
  const ord = (r) => {
    const tl = r.st.tl || [];
    const w = tl.filter((e) => e.t === 'offline-entry-write');
    const rb = tl.find((e) => e.t === 'restore-begin'), re = tl.find((e) => e.t === 'restore-end'), sw = tl.find((e) => e.t === 'sw-register');
    const bn = tl.find((e) => e.t === 'banner-style' && e.display === 'block');
    return { w, rb, re, sw, bn, writes: w.length, restores: tl.filter((e) => e.t === 'restore-begin').length };
  };
  check('VALID', 'AC7-traced-runs-valid-single-write-single-restore-sw-and-banner-observed',
    traced.every((r) => { const o = ord(r); return validOffline(r) && seedOk(r) && o.writes === 1 && o.restores === 1 && !!o.re && !!o.sw && !!o.bn; }),
    traced.map((r) => { const o = ord(r); return `writes=${o.writes} restores=${o.restores} sw=${!!o.sw} banner=${!!o.bn}`; }).join(' | '));
  check('PRES', 'AC7-serviceWorker.register-called-before-restore-begin (SW registration not delayed)', traced.every((r) => { const o = ord(r); return o.sw && o.rb && o.sw.seq < o.rb.seq; }),
    traced.map((r) => { const o = ord(r); return `sw=${o.sw && o.sw.seq} restore-begin=${o.rb && o.rb.seq}`; }).join(' | '));
  check('PS', 'AC7-offline-entry-written-AFTER-restore-end', traced.every((r) => { const o = ord(r); return o.w[0] && o.re && o.w[0].seq > o.re.seq; }),
    traced.map((r) => { const o = ord(r); return `write=${o.w[0] && o.w[0].seq} restore-end=${o.re && o.re.seq}`; }).join(' | '));
  check('PS', 'AC7-banner-applied-AFTER-restore-end', traced.every((r) => { const o = ord(r); return o.bn && o.re && o.bn.seq > o.re.seq; }),
    traced.map((r) => { const o = ord(r); return `banner=${o.bn && o.bn.seq} restore-end=${o.re && o.re.seq}`; }).join(' | '));
  check('PS', 'AC1-traced-final-activityLog-equals-plain-outcome (tool-independence)', traced.every((r) => sameList(r.st.activity, expectedTop(r))) && sameList(traced[0].st.activity.map((x) => x === OFF ? OFF : 'seed'), plain[0].st.activity.map((x) => x === OFF ? OFF : 'seed')),
    `traced0=${JSON.stringify(traced[0].st.activity)}`);

  // ===== AC-2: other offline boots =====
  const noBlob = await scenario({ boot: 'offline', tag: 'A2', noBlob: true });
  check('VALID', 'AC2-offline-no-blob-valid (really offline, banner shown, no blob, app initialised)', noBlob.st.onLineAtStart === false && noBlob.st.banner === 'block' && noBlob.hasBlob === false && noBlob.inited, `onLineAtStart=${noBlob.st.onLineAtStart} banner=${noBlob.st.banner} blob=${noBlob.hasBlob}`);
  check('PRES', 'AC2-offline-no-blob-exactly-one-entry-and-DOM-shows-it (positive control)', sameList(noBlob.st.activity, [OFF]) && noBlob.st.domHasOffline === true, `activity=${JSON.stringify(noBlob.st.activity)}`);

  const omit = await scenario({ boot: 'offline', tag: 'A3', omit: true });
  check('VALID', 'AC2-offline-blob-without-activityLog-key-valid', validOffline(omit) && omit.seeded.ok && omit.seeded.blobActivity === null, `seeded=${JSON.stringify(omit.seeded)}`);
  check('PS', 'AC2-offline-blob-without-activityLog-key -> [offline-entry]', sameList(omit.st.activity, [OFF]), `activity=${JSON.stringify(omit.st.activity)}`);

  const corrupt = await scenario({ boot: 'offline', tag: 'A4', corrupt: true });
  check('VALID', 'AC2-offline-corrupt-blob-valid (decrypt really throws, offline really in effect, app initialised)', corrupt.seeded.ok && corrupt.seeded.corruptDecryptThrows === true && corrupt.st.onLineAtStart === false && corrupt.st.banner === 'block' && corrupt.inited,
    `seeded=${JSON.stringify(corrupt.seeded)} banner=${corrupt.st.banner}`);
  check('PRES', 'AC2-offline-corrupt-blob-starts-fresh-with-exactly-one-entry', sameList(corrupt.st.activity, [OFF]) && corrupt.st.messages.length === 0, `activity=${JSON.stringify(corrupt.st.activity)} messages=${corrupt.st.messages.length}`);

  // ===== AC-3: online boots =====
  const onBlob = await scenario({ boot: 'online', tag: 'O1' });
  check('VALID', 'AC3-online-blob-valid (really online, restore ran)', onBlob.inited && onBlob.restored && onBlob.st.onLineAtStart === true && seedOk(onBlob), `onLineAtStart=${onBlob.st.onLineAtStart} restored=${onBlob.restored}`);
  check('PRES', 'AC3-online-blob-activityLog==seed-exactly-no-offline-entry-banner-hidden-send-enabled',
    sameList(onBlob.st.activity, onBlob.seedActivity) && onBlob.st.banner !== 'block' && onBlob.st.sendDisabled === false && onBlob.st.domHasOffline === false,
    `activity=${JSON.stringify(onBlob.st.activity)} banner=${onBlob.st.banner} sendDisabled=${onBlob.st.sendDisabled}`);
  const onNone = await scenario({ boot: 'online', tag: 'O2', noBlob: true });
  check('VALID', 'AC3-online-no-blob-valid', onNone.inited && onNone.st.onLineAtStart === true && onNone.hasBlob === false, `onLineAtStart=${onNone.st.onLineAtStart} blob=${onNone.hasBlob}`);
  check('PRES', 'AC3-online-no-blob-activityLog==[]-banner-hidden-send-enabled', sameList(onNone.st.activity, []) && onNone.st.banner !== 'block' && onNone.st.sendDisabled === false, `activity=${JSON.stringify(onNone.st.activity)} banner=${onNone.st.banner}`);

  // ===== AC-4: listeners after boot =====
  const t1 = await scenario({
    boot: 'online', tag: 'L1',
    post: async (page, ctx) => {
      await ctx.setOffline(true); await page.waitForTimeout(500);
      const off = await readState(page);
      await ctx.setOffline(false); await page.waitForTimeout(500);
      const on = await readState(page);
      return { off, on };
    },
  });
  check('VALID', 'AC4-online-boot-then-transitions-valid', t1.inited && t1.restored && t1.st.onLineAtStart === true && t1.postRes.off.onLineNow === false && t1.postRes.on.onLineNow === true, `offNow=${t1.postRes.off.onLineNow} onNow=${t1.postRes.on.onLineNow}`);
  check('PRES', 'AC4-offline-event-after-boot -> banner shown + exactly one entry on top of the restored log', t1.postRes.off.banner === 'block' && sameList(t1.postRes.off.activity, expectedTop(t1)), `activity=${JSON.stringify(t1.postRes.off.activity)}`);
  check('PRES', 'AC4-online-event-after-that -> banner hidden + send enabled (entry kept)', t1.postRes.on.banner !== 'block' && t1.postRes.on.sendDisabled === false && count(t1.postRes.on.activity, OFF) === 1, `banner=${t1.postRes.on.banner} sendDisabled=${t1.postRes.on.sendDisabled}`);
  const t2 = await scenario({
    boot: 'offline', tag: 'L2',
    post: async (page, ctx) => { await ctx.setOffline(false); await page.waitForTimeout(500); return readState(page); },
  });
  check('VALID', 'AC4-offline-boot-then-online-valid', validOffline(t2) && seedOk(t2) && t2.postRes.onLineNow === true, `onLineNow=${t2.postRes.onLineNow}`);
  check('PRES', 'AC4-online-event-after-offline-boot -> banner hidden', t2.postRes.banner !== 'block' && t2.postRes.sendDisabled === false, `banner=${t2.postRes.banner}`);

  // ===== AC-5/AC-7: init window held open by the test gate =====
  const g1 = await scenario({ boot: 'offline', tag: 'G1', extra: { gate: true }, during: async (page) => readState(page) });
  check('VALID', 'AC5-gate-really-held-init-open (encryptionKey still null) and offline really in effect', g1.duringRes.keyNull === true && g1.duringRes.onLineAtStart === false && g1.inited && g1.restored, `keyNullDuring=${g1.duringRes.keyNull} onLineAtStart=${g1.duringRes.onLineAtStart}`);
  check('PS', 'AC7-banner-NOT-yet-shown-while-init-is-held-open (documented trade-off, no event occurred)', g1.duringRes.banner !== 'block', `bannerDuring=${g1.duringRes.banner}`);
  check('PS', 'AC7-after-gate-release-banner-shown-and-entry-survives-on-top-of-seed', g1.st.banner === 'block' && sameList(g1.st.activity, expectedTop(g1)), `banner=${g1.st.banner} activity=${JSON.stringify(g1.st.activity)}`);

  const g2 = await scenario({
    boot: 'offline', tag: 'G2', extra: { gate: true },
    during: async (page) => {
      await page.evaluate(() => window.dispatchEvent(new Event('offline'))); // listener fires inside the init window
      return readState(page);
    },
  });
  check('VALID', 'AC5-event-window-valid', g2.duringRes.keyNull === true && g2.duringRes.onLineAtStart === false && g2.inited && g2.restored, `keyNullDuring=${g2.duringRes.keyNull}`);
  check('PRES', 'AC5-offline-listener-still-shows-banner-immediately-inside-the-init-window', g2.duringRes.banner === 'block', `bannerDuring=${g2.duringRes.banner}`);
  check('PS', 'AC5-event-inside-init-window -> after release exactly ONE entry on top of the seed (no loss, no duplicate)', sameList(g2.st.activity, expectedTop(g2)), `activity=${JSON.stringify(g2.st.activity)}`);

  // ===== AC-6: autoInitApp rejection (injected after restore) =====
  const r1 = await scenario({ boot: 'offline', tag: 'R1', extra: { failInit: INJECT_MSG } });
  check('VALID', 'AC6-injected-failure-really-rejected-autoInitApp-after-restore (restore ran, offline in effect)', r1.inited && r1.restored && r1.st.onLineAtStart === false && sameList(r1.st.messages, [r1.mark + '-msg']),
    `restored=${r1.restored} rejections=${JSON.stringify(r1.st.rejections)}`);
  check('PRES', 'AC6-updateOnlineStatus-STILL-runs-when-autoInitApp-rejects (banner shown)', r1.st.banner === 'block', `banner=${r1.st.banner}`);
  check('PS', 'AC6-offline-entry-written-after-the-rejected-init (entry on top of restored seed)', sameList(r1.st.activity, expectedTop(r1)), `activity=${JSON.stringify(r1.st.activity)}`);
  check('PRES', 'AC6-rejection-still-reported-as-unhandled-rejection (not swallowed)', r1.st.rejections.some((m) => m.includes(INJECT_MSG)), `rejections=${JSON.stringify(r1.st.rejections)}`);

  // ===== hygiene =====
  check('PRES', 'no-uncaught-page-errors-in-non-injected-scenarios', pageErrors.filter((e) => !e.scenario.includes('(injected)')).length === 0,
    pageErrors.filter((e) => !e.scenario.includes('(injected)')).slice(0, 3).map((e) => `${e.scenario}: ${e.error}`).join(' | '));

  observe('plain-offline-blob-final-activityLog', b0.st.activity);
  observe('traced-order', ord(traced[0]).w[0] && ord(traced[0]).re ? (ord(traced[0]).w[0].seq > ord(traced[0]).re.seq ? 'WRITE_AFTER_RESTORE' : 'WRITE_BEFORE_RESTORE') : 'UNKNOWN',
    JSON.stringify({ sw: ord(traced[0]).sw && ord(traced[0]).sw.seq, restoreBegin: ord(traced[0]).rb && ord(traced[0]).rb.seq, restoreEnd: ord(traced[0]).re && ord(traced[0]).re.seq, write: ord(traced[0]).w[0] && ord(traced[0]).w[0].seq, banner: ord(traced[0]).bn && ord(traced[0]).bn.seq }));
  observe('banner-during-held-init (no event)', g1.duringRes.banner);

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  const by = (t) => ({ total: checks.filter((c) => c.tag === t).length, failed: failed.filter((c) => c.tag === t).map((c) => c.name) });
  const summary = { VALID: by('VALID'), PRES: by('PRES'), PS: by('PS') };
  const verdict = summary.VALID.failed.length ? 'INVALID' : (failed.length ? 'REJECTED' : 'ACCEPTED');
  console.log(`\n=== SUMMARY ===\n${checks.length - failed.length}/${checks.length} checks passed`);
  for (const t of ['VALID', 'PRES', 'PS']) console.log(`${t}: ${summary[t].total - summary[t].failed.length}/${summary[t].total}${summary[t].failed.length ? ' — failing: ' + summary[t].failed.join(' ; ') : ''}`);
  console.log(`S6-VERDICT = ${verdict}  (chromium ${chromiumVersion}; frontend=${path.relative(HERE, FRONTEND_DIR) || '.'})`);
  await writeFile(RESULTS_FILE, JSON.stringify({ slice: 'core-6', option: 'O2', chromium: chromiumVersion, verdict, summary, checks, observed }, null, 2) + '\n');
  console.log(`results -> ${RESULTS_FILE}`);
  process.exitCode = verdict === 'ACCEPTED' ? 0 : 1;
} catch (e) {
  console.log(`[FAIL][VALID] script-crashed — ${e && e.stack ? e.stack : e}`);
  try { if (browser) await browser.close(); } catch {}
  console.log('\n=== SUMMARY ===\nscript crashed before completion\nS6-VERDICT = INVALID');
  process.exitCode = 2;
}
