/* ==========================================================================
   e2e/phase2-core-slice5-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9
   "core", TARGET SLICE 5 (EVIDENCE ONLY, no production change):
   runtime test, in real Chromium, of inference I-1 (CP-10 §3):

     "On an OFFLINE boot, updateOnlineStatus() -> logActivity(...) rebinds
      `activityLog` BEFORE the async restorePersistableState() assigns the
      restored `activityLog`, so the boot-time entry may be lost."

   Real HTML + real modules + real autoInitApp / persistState / localStore /
   encryptState (no mocks, no stubs of app logic). "Offline" is Chromium's own
   network emulation (BrowserContext.setOffline): the script PROVES, per boot,
   that navigator.onLine === false at document start, that the app's offline
   banner is shown, and (positive control) that the offline entry IS written
   when nothing is restored. The document is served through context.route from
   https://nexus.test (a secure context, so crypto.subtle exists) because the
   page itself cannot be fetched from a real server while the context is offline.

   Check kinds
     [PASS]/[FAIL]  measurement-validity and internal-consistency checks
                    (controls, offline really in effect, restore really ran,
                    plain vs traced agreement, mechanism explains outcome).
     [OBSERVED]     the I-1 outcome itself. It is reported, NOT asserted: if I-1
                    were false the script would still report it faithfully.
   Final line:  I1-VERDICT = LOST | SURVIVES | INCONCLUSIVE  (+ validity count).
   Exit code 0 iff every [PASS]/[FAIL] validity check passed.

   Variants
     plain  : only a read-only probe of navigator.onLine at document start.
     traced : additionally wraps Array.prototype.unshift (to timestamp the
              offline entry write) and the window.PersistableStateCore bridge
              (to see activityLog right before/after restore). It exists only to
              explain the ORDER; the outcome must agree with the plain variant.

   FRONTEND_DIR defaults to ../frontend (self-locating); NEXUS_FRONTEND_DIR
   overrides it (used ONLY to point the same script at scratch mutated copies
   to prove the test can discriminate; production files are never edited).
   Results JSON: NEXUS_S5_RESULTS (default: baseline/evidence/phase2-core-slice5-i1-results.json).
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S5_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-core-slice5-i1-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const OFFLINE_ACTION = 'انقطع الاتصال';
const REPEATS_PLAIN = 5;
const REPEATS_TRACED = 3;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const checks = [];
const observed = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}
function observe(name, value, detail) {
  observed.push({ name, value, detail: detail ?? null });
  console.log(`[OBSERVED] ${name} = ${typeof value === 'string' ? value : JSON.stringify(value)}${detail ? ' — ' + detail : ''}`);
}

const pageErrors = [];
let browser = null;

async function newContext() {
  const ctx = await browser.newContext(); // fresh context => fresh IndexedDB (no state shared between scenarios)
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort(); // nothing external is ever fetched
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    try {
      const content = await readFile(path.join(FRONTEND_DIR, rel));
      await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
    } catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  return ctx;
}

// Init scripts run before any page script on EVERY document of the context.
const PLAIN_INIT = () => { window.__onLineAtDocStart = navigator.onLine; };
const TRACED_INIT = (OFFLINE_ACTION) => {
  window.__onLineAtDocStart = navigator.onLine;
  window.__tl = [];
  let seq = 0;
  const rec = (t, extra) => window.__tl.push(Object.assign({ seq: seq++, t }, extra));
  const origUnshift = Array.prototype.unshift;
  Array.prototype.unshift = function (...a) {
    if (a.length === 1 && a[0] && typeof a[0] === 'object' && a[0].action === OFFLINE_ACTION) {
      rec('offline-entry-write', { onLine: navigator.onLine });
    }
    return origUnshift.apply(this, a);
  };
  let core;
  Object.defineProperty(window, 'PersistableStateCore', {
    configurable: true,
    get() { return core; },
    set(v) {
      core = Object.assign({}, v, {
        restorePersistableState(registry, decrypted) {
          const before = activityLog.map((x) => x.action); // bare name, resolved at call time
          rec('restore-begin', { before, decrypted: decrypted && Array.isArray(decrypted.activityLog) ? decrypted.activityLog.map((x) => x.action) : null });
          const r = v.restorePersistableState(registry, decrypted);
          rec('restore-end', { after: activityLog.map((x) => x.action) });
          return r;
        },
      });
    },
  });
};

async function open(ctx, variant) {
  await ctx.addInitScript(variant === 'traced' ? TRACED_INIT : PLAIN_INIT, ...(variant === 'traced' ? [OFFLINE_ACTION] : []));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return page;
}
async function waitInit(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}
async function waitRestored(page, markerContent) {
  try { await page.waitForFunction((m) => Array.isArray(messages) && messages.some((x) => x && x.content === m), markerContent, { timeout: 15000 }); return true; }
  catch { return false; }
}
const mkSeed = (mark) => [
  { ts: '2001-02-03T04:05:06.000Z', action: mark + '-act-1', detail: 'd1' },
  { ts: '2001-02-03T04:05:07.000Z', action: mark + '-act-2', detail: 'd2' },
];
async function seedBlob(page, mark, { omitActivityLog = false } = {}) {
  return page.evaluate(async ({ mark, seed, omit }) => {
    try {
      messages = [{ role: 'user', agentId: null, agentName: 'أنت', content: mark + '-msg', type: 'text' }];
      activityLog = seed;
      if (omit) { // blob WITHOUT the activityLog key (restore must fall back to default())
        const snap = snapshotPersistableState();
        delete snap.activityLog;
        const payload = await encryptState(snap, encryptionKey);
        await localStore.set(STORAGE_KEY, JSON.stringify(payload));
      } else {
        await persistState();
      }
      const res = await localStore.get(STORAGE_KEY);
      const dec = await decryptState(JSON.parse(res.value), encryptionKey);
      return { ok: true, blobActivity: Array.isArray(dec.activityLog) ? dec.activityLog.map((x) => x.action) : null, blobMsgs: dec.messages.map((m) => m.content) };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, { mark, seed: mkSeed(mark), omit: omitActivityLog });
}
const readState = (page) => page.evaluate((OFF) => {
  try {
    const dom = document.getElementById('activityList');
    return {
      onLineAtStart: window.__onLineAtDocStart, onLineNow: navigator.onLine,
      banner: document.getElementById('offlineBanner').style.display,
      activity: activityLog.map((x) => x.action), messages: messages.map((m) => m.content),
      domHasOfflineEntry: dom ? dom.innerText.includes(OFF) : null,
      domEntryCount: dom ? dom.querySelectorAll('.log-item').length : null,
      tl: window.__tl || null,
    };
  } catch (e) { return { error: String(e) }; }
}, OFFLINE_ACTION);
const durableActivity = (page) => page.evaluate(async () => {
  try {
    await persistState(); // what the next real save would write
    const res = await localStore.get(STORAGE_KEY);
    const dec = await decryptState(JSON.parse(res.value), encryptionKey);
    return Array.isArray(dec.activityLog) ? dec.activityLog.map((x) => x.action) : null;
  } catch (e) { return { error: String(e) }; }
});
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
const count = (arr, v) => (Array.isArray(arr) ? arr.filter((x) => x === v).length : -1);

/* Seed online (real persistState), then reboot offline or online. Returns the state after settle. */
async function bootWithBlob({ variant, boot, tag, omitActivityLog = false }) {
  const mark = `S5-${tag}-${variant}-${boot}-${Date.now()}`;
  const ctx = await newContext();
  try {
    const page = await open(ctx, variant);
    await page.goto(ORIGIN + '/', { waitUntil: 'load' });
    const inited0 = await waitInit(page);
    const seeded = await seedBlob(page, mark, { omitActivityLog });
    if (boot === 'offline') await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    const inited = await waitInit(page);
    const restored = await waitRestored(page, mark + '-msg');
    await page.waitForTimeout(800); // let anything else that wants to run, run
    const st = await readState(page);
    const durable = await durableActivity(page);
    return { mark, seedActivity: mkSeed(mark).map((x) => x.action), inited0, inited, restored, seeded, st, durable };
  } finally { await ctx.close(); }
}

try {
  browser = await chromium.launch();
  const chromiumVersion = browser.version();
  console.log(`Chromium ${chromiumVersion}; FRONTEND_DIR=${FRONTEND_DIR}`);

  // ---------------- C0: control — ONLINE boot with persisted blob (negative control for the offline marker) ----------------
  const c0 = await bootWithBlob({ variant: 'plain', boot: 'online', tag: 'C0' });
  check('C0-online-boot-seed-persisted', c0.seeded.ok && sameList(c0.seeded.blobActivity, c0.seedActivity), JSON.stringify(c0.seeded));
  check('C0-online-boot-really-online', c0.st.onLineAtStart === true && c0.st.banner !== 'block', `onLineAtStart=${c0.st.onLineAtStart} banner=${c0.st.banner}`);
  check('C0-online-boot-restore-ran-and-activityLog-restored-exactly', c0.inited && c0.restored && sameList(c0.st.activity, c0.seedActivity), `activity=${JSON.stringify(c0.st.activity)}`);
  check('C0-online-boot-no-offline-entry-anywhere', count(c0.st.activity, OFFLINE_ACTION) === 0 && c0.st.domHasOfflineEntry === false, `mem=${count(c0.st.activity, OFFLINE_ACTION)} dom=${c0.st.domHasOfflineEntry}`);

  // ---------------- C1: POSITIVE control — OFFLINE boot with NO persisted blob (nothing restores) ----------------
  {
    const ctx = await newContext();
    try {
      await ctx.setOffline(true); // offline from the very first document of a fresh profile => no blob can exist
      const page = await open(ctx, 'plain');
      await page.goto(ORIGIN + '/', { waitUntil: 'load' });
      const inited = await waitInit(page);
      await page.waitForTimeout(1200);
      const st = await readState(page);
      const hasBlob = await page.evaluate(async () => { try { await localStore.get(STORAGE_KEY); return true; } catch { return false; } });
      check('C1-offline-no-blob-really-offline', st.onLineAtStart === false && st.onLineNow === false && st.banner === 'block', `onLineAtStart=${st.onLineAtStart} banner=${st.banner}`);
      check('C1-offline-no-blob-nothing-to-restore', inited && hasBlob === false, `inited=${inited} blobPresent=${hasBlob}`);
      check('C1-POSITIVE-CONTROL-offline-entry-written-and-visible', count(st.activity, OFFLINE_ACTION) === 1 && st.domHasOfflineEntry === true, `activity=${JSON.stringify(st.activity)} dom=${st.domHasOfflineEntry}`);
      observe('C1-no-blob-offline-boot-entry', count(st.activity, OFFLINE_ACTION) === 1 ? 'SURVIVES' : 'ABSENT');
    } finally { await ctx.close(); }
  }

  // ---------------- B: the I-1 target — OFFLINE boot WITH persisted blob (plain, repeated) ----------------
  const plainRuns = [];
  for (let i = 0; i < REPEATS_PLAIN; i++) plainRuns.push(await bootWithBlob({ variant: 'plain', boot: 'offline', tag: 'B' + i }));
  const classify = (r) => {
    const valid = r.inited && r.restored && r.st.onLineAtStart === false && r.st.banner === 'block' && sameList(r.st.messages, [r.mark + '-msg']);
    if (!valid) return 'INVALID';
    const present = count(r.st.activity, OFFLINE_ACTION) >= 1;
    return present ? 'SURVIVES' : 'LOST';
  };
  plainRuns.forEach((r, i) => {
    check(`B${i}-plain-offline-boot-valid-measurement`, classify(r) !== 'INVALID',
      `inited=${r.inited} restored=${r.restored} onLineAtStart=${r.st.onLineAtStart} banner=${r.st.banner} seedPersisted=${r.seeded.ok && sameList(r.seeded.blobActivity, r.seedActivity)}`);
    check(`B${i}-seed-was-persisted-before-reboot`, r.seeded.ok && sameList(r.seeded.blobActivity, r.seedActivity));
  });
  const plainVerdicts = plainRuns.map(classify);
  check('B-plain-verdicts-identical-across-runs', new Set(plainVerdicts).size === 1, JSON.stringify(plainVerdicts));
  const b0 = plainRuns[0];
  observe('B-plain-offline-boot-with-blob-verdict', plainVerdicts[0], `runs=${JSON.stringify(plainVerdicts)}`);
  observe('B-plain-final-activityLog-in-memory', b0.st.activity, `seed was ${JSON.stringify(b0.seedActivity)}`);
  observe('B-plain-final-activityLog-equals-seed-exactly', sameList(b0.st.activity, b0.seedActivity));
  observe('B-plain-DOM-activity-panel-shows-offline-entry', b0.st.domHasOfflineEntry, `dom entries=${b0.st.domEntryCount} (rendered by logActivity at boot; no re-render is asserted here)`);
  observe('B-plain-next-save-would-persist-activityLog', b0.durable, 'activityLog inside the blob after persistState() called post-boot');

  // ---------------- B-traced: same scenario + ordering evidence ----------------
  const tracedRuns = [];
  for (let i = 0; i < REPEATS_TRACED; i++) tracedRuns.push(await bootWithBlob({ variant: 'traced', boot: 'offline', tag: 'T' + i }));
  const tracedVerdicts = tracedRuns.map(classify);
  const order = (r) => {
    const tl = r.st.tl || [];
    const w = tl.find((e) => e.t === 'offline-entry-write');
    const rb = tl.find((e) => e.t === 'restore-begin');
    const re = tl.find((e) => e.t === 'restore-end');
    return { w, rb, re, writeBeforeRestore: !!(w && rb && w.seq < rb.seq), writes: tl.filter((e) => e.t === 'offline-entry-write').length, restores: tl.filter((e) => e.t === 'restore-begin').length };
  };
  tracedRuns.forEach((r, i) => {
    const o = order(r);
    check(`T${i}-traced-valid-measurement-and-single-write-single-restore`, classify(r) !== 'INVALID' && o.writes === 1 && o.restores === 1 && !!o.re, `verdict=${classify(r)} writes=${o.writes} restores=${o.restores}`);
  });
  check('T-traced-verdicts-identical-across-runs', new Set(tracedVerdicts).size === 1, JSON.stringify(tracedVerdicts));
  check('T-plain-and-traced-agree', tracedVerdicts[0] === plainVerdicts[0], `plain=${plainVerdicts[0]} traced=${tracedVerdicts[0]}`);
  const t0 = tracedRuns[0], o0 = order(t0);
  observe('T-order-offline-write-vs-restore', o0.writeBeforeRestore ? 'WRITE_BEFORE_RESTORE' : 'WRITE_AFTER_RESTORE', `write.seq=${o0.w && o0.w.seq} restore-begin.seq=${o0.rb && o0.rb.seq}`);
  observe('T-activityLog-just-BEFORE-restore', o0.rb && o0.rb.before, 'contains the boot entry iff it was written before restore');
  observe('T-decrypted-activityLog-given-to-restore', o0.rb && o0.rb.decrypted);
  observe('T-activityLog-just-AFTER-restore', o0.re && o0.re.after);
  // mechanism-explains-outcome (consistency, not the finding)
  const mechanismConsistent = (r) => {
    const o = order(r), v = classify(r);
    if (v === 'LOST') return o.writeBeforeRestore && count(o.rb.before, OFFLINE_ACTION) >= 1 && count(o.re.after, OFFLINE_ACTION) === 0;
    if (v === 'SURVIVES') return count(o.re.after, OFFLINE_ACTION) >= 1 || !o.writeBeforeRestore;
    return false;
  };
  check('T-mechanism-explains-outcome', tracedRuns.every(mechanismConsistent), `verdict=${tracedVerdicts[0]} writeBeforeRestore=${o0.writeBeforeRestore}`);

  // ---------------- D: OFFLINE boot, blob WITHOUT the activityLog key (restore falls back to default()) ----------------
  const d = await bootWithBlob({ variant: 'plain', boot: 'offline', tag: 'D', omitActivityLog: true });
  check('D-valid-measurement-blob-lacks-activityLog', classify(d) !== 'INVALID' && d.seeded.ok && d.seeded.blobActivity === null, `seeded=${JSON.stringify(d.seeded)}`);
  observe('D-offline-boot-blob-without-activityLog-verdict', classify(d), `activity=${JSON.stringify(d.st.activity)}`);

  // ---------------- F: post-boot offline transition (restore already done) ----------------
  {
    const mark = 'S5-F-' + Date.now();
    const ctx = await newContext();
    try {
      const page = await open(ctx, 'plain');
      await page.goto(ORIGIN + '/', { waitUntil: 'load' });
      await waitInit(page);
      const seeded = await seedBlob(page, mark);
      await page.reload({ waitUntil: 'load' }); // online reboot, restore completes
      await waitInit(page);
      const restored = await waitRestored(page, mark + '-msg');
      await page.waitForTimeout(500);
      await ctx.setOffline(true); // fires window 'offline' -> updateOnlineStatus -> logActivity AFTER restore
      await page.waitForTimeout(500);
      const st = await readState(page);
      check('F-post-boot-transition-valid', seeded.ok && restored && st.onLineNow === false && st.banner === 'block', `restored=${restored} onLineNow=${st.onLineNow} banner=${st.banner}`);
      observe('F-post-boot-offline-event-entry', count(st.activity, OFFLINE_ACTION) === 1 && st.activity.slice(1).every((v, i) => v === mkSeed(mark)[i].action) ? 'SURVIVES_ON_TOP_OF_RESTORED_LOG' : 'UNEXPECTED', `activity=${JSON.stringify(st.activity)}`);
    } finally { await ctx.close(); }
  }

  check('no-uncaught-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();

  // ---------------- verdict ----------------
  const failed = checks.filter((c) => !c.ok);
  const verdict = failed.length ? 'INCONCLUSIVE' : plainVerdicts[0];
  console.log(`\n=== SUMMARY ===\n${checks.length - failed.length}/${checks.length} validity checks passed`);
  console.log(`I1-VERDICT = ${verdict}  (chromium ${chromiumVersion}; frontend=${path.relative(HERE, FRONTEND_DIR) || '.'})`);
  const out = {
    slice: 'core-5', inference: 'I-1', chromium: chromiumVersion, verdict,
    validity: { passed: checks.length - failed.length, total: checks.length, failed: failed.map((c) => c.name) },
    checks, observed,
  };
  await writeFile(RESULTS_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(`results -> ${RESULTS_FILE}`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.log(`[FAIL] script-crashed — ${e && e.stack ? e.stack : e}`);
  try { if (browser) await browser.close(); } catch {}
  console.log('\n=== SUMMARY ===\nscript crashed before completion\nI1-VERDICT = INCONCLUSIVE');
  process.exitCode = 2;
}
