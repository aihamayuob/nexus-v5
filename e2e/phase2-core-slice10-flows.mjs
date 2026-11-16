/* ==========================================================================
   e2e/phase2-core-slice10-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9 "core",
   TARGET SLICE 10: acceptance tests for the C2 pilot — `agentOrder` owned by modules/state.mjs and served to the
   classic script through a global accessor on `window` (mechanism "B" of CP-17).
   Criteria written first (frozen): baseline/evidence/phase2-core-slice10-acceptance-criteria.md

   Real HTML + real modules + real moveAgentOrder / getOrderedAgents / persistState / autoInitApp (no stubs of app logic).
   The page is served from https://nexus.test via context.route; every NON-origin request is aborted.

   Check kinds (tag in the name, printed as [KIND])
     VALID  measurement validity / controls — must always be green, else verdict INVALID
     PRES   behavior that must be preserved — green PRE and POST
     PS     patch-specific — RED on the unpatched tree, GREEN after the patch
   Final line:  S10-VERDICT = ACCEPTED | REJECTED | INVALID  (+ per-kind counts). Exit 0 iff ACCEPTED.

   NEXUS_FRONTEND_DIR points the script at another frontend dir (mutants / pristine clone); NEXUS_S10_RESULTS overrides the results
   JSON (default baseline/evidence/phase2-core-slice10-results.json). The JSON carries a FINGERPRINT (window own-property names,
   same-origin script requests, app-state hash) that phase2-core-slice10-compare.mjs compares between a PRE and a POST run.
   Deterministic: no timings/timestamps.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S10_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-core-slice10-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const OTHER15 = ['messages', 'selectedAgentIds', 'knowledgeBase', 'activityLog', 'customAgents', 'longTermMemory', 'workflows',
  'usageLog', 'errorLog', 'activeGroupId', 'uploadedDocs', 'projects', 'decisionJournal', 'topicMonitors', 'briefingLastSeenAt'];
const FP_KEYS = OTHER15.filter((k) => k !== 'activityLog' && k !== 'errorLog'); // log-like keys are volatile

const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const pres = (n, ok, d) => rec('PRES', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);
const pageErrors = [];
const scriptRequests = new Set();
let browser = null;

async function newScenario() {
  const ctx = await browser.newContext(); // fresh IndexedDB per scenario
  await ctx.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.origin !== ORIGIN) return route.abort(); // nothing external is fetched
    const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
    if (/\.(m?js)$/.test(rel)) scriptRequests.add('/' + rel);
    try {
      const content = await readFile(path.join(FRONTEND_DIR, rel));
      await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
    } catch { await route.fulfill({ status: 404, body: 'not found' }); }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page };
}
async function waitInit(page) {
  try { await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); return true; }
  catch { return false; }
}
async function boot(page) {
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  return waitInit(page);
}
async function reload(page, waitExpr, arg) {
  await page.reload({ waitUntil: 'load' });
  const inited = await waitInit(page);
  let restored = false;
  try { await page.waitForFunction(waitExpr, arg, { timeout: 15000 }); restored = true; } catch { restored = false; }
  return { inited, restored };
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

let chromiumVersion = '?';
const fingerprint = { windowOwnProps: null, bootScriptRequests: null, scriptRequests: null, stateSha256: null };
const fileHashes = {};

try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();
  for (const f of [HTML_FILE, 'main.js']) fileHashes[f] = sha(await readFile(path.join(FRONTEND_DIR, f)));

  // ===================== scenario A — behavior (PRES) + fingerprint =====================
  {
    const { ctx, page } = await newScenario();
    try {
      const inited = await boot(page);
      valid('A-boot-and-init', inited, `inited=${inited}`);
      const fns = await page.evaluate(() => ['getOrderedAgents', 'getAllAgents', 'moveAgentOrder', 'renderReorderList', 'snapshotPersistableState',
        'restorePersistableState', 'resetPersistableState', 'persistState'].map((n) => typeof window[n]).join(','));
      valid('A-functions-present', fns === 'function,function,function,function,function,function,function,function', fns);
      fingerprint.windowOwnProps = await page.evaluate(() => Object.getOwnPropertyNames(window).sort());
      // Boot-time requests only (captured BEFORE scenario B's own dynamic import of state.mjs, which is itself a request). Added after the first PRE
      // run showed that `scriptRequests` (end of run) contains the test's own import on the unmodified tree — see CP-18.
      fingerprint.bootScriptRequests = [...scriptRequests].sort();

      // P1 initial
      const init = await page.evaluate(() => {
        try {
          const all = getAllAgents().map((a) => a.id), ord = getOrderedAgents().map((a) => a.id);
          const reg = PERSISTABLE_STATE.agentOrder.get();
          return { ok: true, all, ord, regIsArray: Array.isArray(reg), regLen: reg.length, bare: Array.isArray(agentOrder) && agentOrder.length === 0 };
        } catch (e) { return { ok: false, error: String(e) }; }
      });
      valid('A-agents-readable', init.ok && init.all.length >= 3, init.ok ? `agents=${init.all.length}` : init.error);
      pres('AC3-initial-order-natural-registry-empty-bare-readable',
        init.ok && JSON.stringify(init.ord) === JSON.stringify(init.all) && init.regIsArray && init.regLen === 0 && init.bare === true, JSON.stringify({ regLen: init.regLen, bare: init.bare }));

      // P2/P3/P12 real UI function
      const moved = await page.evaluate(async () => {
        try {
          const before = getOrderedAgents().map((a) => a.id);
          await moveAgentOrder(before[0], 1);
          const after = getOrderedAgents().map((a) => a.id);
          return { ok: true, before, after, reg: PERSISTABLE_STATE.agentOrder.get().slice(), rows: document.querySelectorAll('#reorderList .kb-item').length };
        } catch (e) { return { ok: false, error: String(e) }; }
      });
      valid('A-moveAgentOrder-ran', moved.ok, moved.ok ? '' : moved.error);
      const swapped = moved.ok && moved.after[0] === moved.before[1] && moved.after[1] === moved.before[0] &&
        JSON.stringify(moved.after.slice(2)) === JSON.stringify(moved.before.slice(2));
      pres('AC3-moveAgentOrder-swaps-first-two', swapped, moved.ok ? `first=${moved.before[0]}` : moved.error);
      pres('AC3-registry-sees-full-explicit-order', moved.ok && JSON.stringify(moved.reg) === JSON.stringify(moved.after), moved.ok ? `registryLen=${moved.reg.length}` : moved.error);
      pres('AC3-reorder-list-rows-equal-agent-count', moved.ok && moved.rows === moved.after.length, moved.ok ? `rows=${moved.rows} agents=${moved.after.length}` : moved.error);

      // P4 persist -> reload -> restore through the real autoInitApp
      const expectedFirst = moved.ok ? moved.after[0] : null;
      const r1 = await reload(page, (id) => { try { return getOrderedAgents()[0].id === id; } catch { return false; } }, expectedFirst);
      const after1 = await page.evaluate(() => { try { return getOrderedAgents().map((a) => a.id); } catch (e) { return ['ERR:' + e]; } });
      pres('AC3-order-survives-reload-via-autoInitApp', r1.inited && r1.restored && moved.ok && JSON.stringify(after1) === JSON.stringify(moved.after), `inited=${r1.inited} restored=${r1.restored}`);

      // fixed-scenario app-state fingerprint (persisted state after the reload)
      const st = await page.evaluate((keys) => { const o = {}; for (const k of keys) o[k] = PERSISTABLE_STATE[k].get(); o.agentOrder = PERSISTABLE_STATE.agentOrder.get(); return JSON.stringify(o); }, FP_KEYS);
      fingerprint.stateSha256 = sha(st);

      // semantics: shallow snapshot, rebind on restore, in-place mutation, bare write
      const sem = await page.evaluate(() => {
        const out = {};
        try {
          out.snapshotIsLiveRef = snapshotPersistableState().agentOrder === agentOrder;
          const ref = PERSISTABLE_STATE.agentOrder.get();
          agentOrder.push('zz-inplace');
          out.inPlaceVisible = ref.includes('zz-inplace') && PERSISTABLE_STATE.agentOrder.get() === ref;
          agentOrder.pop();
          const ids = getAllAgents().map((a) => a.id);
          agentOrder = [ids[1], ids[0]];
          out.bareWriteRegistry = JSON.stringify(PERSISTABLE_STATE.agentOrder.get()) === JSON.stringify([ids[1], ids[0]]);
          out.bareWriteOrdered = getOrderedAgents()[0].id === ids[1] && getOrderedAgents()[1].id === ids[0];
          const old = agentOrder;
          const snap = snapshotPersistableState();
          restorePersistableState(Object.assign({}, snap, { agentOrder: ['x-restored'] }));
          out.restoreRebinds = old !== agentOrder && agentOrder[0] === 'x-restored' && old[0] === ids[1];
          out.others = true;
        } catch (e) { out.error = String(e); }
        return out;
      });
      pres('AC3-snapshot-value-is-the-live-reference', sem.snapshotIsLiveRef === true, JSON.stringify(sem));
      pres('AC3-in-place-mutation-visible-to-registry', sem.inPlaceVisible === true, '');
      pres('AC3-bare-name-write-visible-to-registry-and-getOrderedAgents', sem.bareWriteRegistry === true && sem.bareWriteOrdered === true, '');
      pres('AC3-restorePersistableState-rebinds-old-reference-detached', sem.restoreRebinds === true, sem.error || '');

      // P6 blob lacking the key -> fresh independent default (real autoInitApp)
      const crafted = await page.evaluate(async () => {
        try {
          PERSISTABLE_STATE.knowledgeBase.set([{ id: 's10-mark', title: 'm', content: 'c' }]);
          const snap = snapshotPersistableState();
          delete snap.agentOrder;
          const payload = await encryptState(snap, encryptionKey);
          await localStore.set(STORAGE_KEY, JSON.stringify(payload));
          return { ok: true, keys: Object.keys(snap).length };
        } catch (e) { return { ok: false, error: String(e) }; }
      });
      valid('A-crafted-blob-without-agentOrder-written', crafted.ok && crafted.keys === 15, crafted.ok ? `keys=${crafted.keys}` : crafted.error);
      const r2 = await reload(page, () => { try { return knowledgeBase.some((x) => x && x.id === 's10-mark'); } catch { return false; } });
      valid('A-crafted-blob-restored-via-autoInitApp', r2.inited && r2.restored, `inited=${r2.inited} restored=${r2.restored}`);
      const miss = await page.evaluate(() => {
        try {
          const live = PERSISTABLE_STATE.agentOrder.get();
          const all = getAllAgents().map((a) => a.id), ord = getOrderedAgents().map((a) => a.id);
          const d = PERSISTABLE_STATE.agentOrder.default();
          return { isEmptyArray: Array.isArray(live) && live.length === 0, fresh: live !== d, natural: JSON.stringify(all) === JSON.stringify(ord), bareSame: agentOrder === live };
        } catch (e) { return { error: String(e) }; }
      });
      pres('AC3-missing-key-restores-fresh-empty-default-and-natural-order', miss.isEmptyArray === true && miss.fresh === true && miss.natural === true && miss.bareSame === true, JSON.stringify(miss));

      // P5 reset
      const reset = await page.evaluate(() => {
        try {
          agentOrder = ['stale'];
          resetPersistableState();
          const all = getAllAgents().map((a) => a.id), ord = getOrderedAgents().map((a) => a.id);
          return { natural: JSON.stringify(all) === JSON.stringify(ord), regLen: PERSISTABLE_STATE.agentOrder.get().length, bareLen: agentOrder.length };
        } catch (e) { return { error: String(e) }; }
      });
      pres('AC3-reset-restores-default-and-natural-order', reset.natural === true && reset.regLen === 0 && reset.bareLen === 0, JSON.stringify(reset));

      // P11 isolation of the other 15 variables
      const iso = await page.evaluate((names) => {
        const bad = [];
        for (const n of names) {
          let readable = true;
          try { (0, eval)(n); } catch { readable = false; }
          if (n in window || !readable) bad.push(n + (n in window ? ':on-window' : '') + (readable ? '' : ':unreadable'));
        }
        return bad;
      }, OTHER15);
      pres('AC4-other-15-variables-not-on-window-and-bare-readable', iso.length === 0, `bad=[${iso.join(',')}]`);
    } finally { await ctx.close(); }
  }

  // ===================== scenario B — patch-specific (PS) + controls =====================
  {
    const { ctx, page } = await newScenario();
    try {
      valid('B-boot-and-init', await boot(page));
      // AC-1 descriptor
      const d = await page.evaluate(() => {
        const x = Object.getOwnPropertyDescriptor(window, 'agentOrder');
        return x ? { has: true, accessor: typeof x.get === 'function' && typeof x.set === 'function' && !('value' in x), configurable: x.configurable, enumerable: x.enumerable } : { has: false };
      });
      ps('AC1-window-agentOrder-is-an-accessor-configurable-non-enumerable', d.has && d.accessor && d.configurable === true && d.enumerable === false, JSON.stringify(d));
      // AC-2 identity (no shadow)
      const idn = await page.evaluate(() => {
        try {
          agentOrder = ['id-a'];
          const w1 = window.agentOrder;
          window.agentOrder = ['id-b'];
          const b2 = agentOrder;
          return { bareWriteSeenViaWindow: Array.isArray(w1) && w1[0] === 'id-a', windowWriteSeenViaBare: Array.isArray(b2) && b2[0] === 'id-b' && b2 === window.agentOrder };
        } catch (e) { return { error: String(e) }; }
      });
      ps('AC2-bare-name-and-window-property-are-the-same-binding', idn.bareWriteSeenViaWindow === true && idn.windowWriteSeenViaBare === true, JSON.stringify(idn));
      // AC-2 static: no classic declaration
      const html = await readFile(path.join(FRONTEND_DIR, HTML_FILE), 'utf8');
      ps('AC2-static-monolith-has-no-top-level-declaration-of-agentOrder', !/^(let|const|var)\s+agentOrder\b/m.test(html), '');
      // module surface
      const mod = await page.evaluate(async () => {
        try { const m = await import('/modules/state.mjs'); return { ok: true, exportsFn: typeof m.installGlobalStateAccessors === 'function', names: Object.keys(m).sort().join(',') }; }
        catch (e) { return { ok: false, error: String(e && e.message || e).slice(0, 80) }; }
      });
      ps('AC6-modules-state-mjs-exports-installGlobalStateAccessors', mod.ok && mod.exportsFn, JSON.stringify(mod));
      // AC-5 static order in main.js
      const main = await readFile(path.join(FRONTEND_DIR, 'main.js'), 'utf8');
      const iInstall = main.indexOf('installGlobalStateAccessors(window);'), iBridge = main.indexOf('window.PersistableStateCore = '), iFirst = main.indexOf('window.applyTheme();');
      ps('AC5-static-main-js-installs-after-bridges-and-before-the-first-startup-call', iInstall > 0 && iBridge > 0 && iFirst > 0 && iInstall > iBridge && iInstall < iFirst, JSON.stringify({ iBridge, iInstall, iFirst }));
      // idempotent re-install keeps the value
      const re = await page.evaluate(async () => {
        try {
          agentOrder = ['keep-me'];
          const m = await import('/modules/state.mjs');
          m.installGlobalStateAccessors(window);
          const x = Object.getOwnPropertyDescriptor(window, 'agentOrder');
          return { kept: Array.isArray(agentOrder) && agentOrder[0] === 'keep-me', stillAccessor: !!x && typeof x.get === 'function' };
        } catch (e) { return { error: String(e && e.message || e).slice(0, 80) }; }
      });
      ps('AC6-install-is-idempotent-value-survives-a-second-install', re.kept === true && re.stillAccessor === true, JSON.stringify(re));
      // control for the ownership test: deleting a NON-property classic let does not make its bare name unreadable
      const ctl = await page.evaluate(() => { try { delete window.messages; return typeof messages !== 'undefined'; } catch (e) { return false; } });
      valid('B-control-delete-of-a-classic-let-leaves-the-bare-name-readable', ctl === true, `messagesStillReadable=${ctl}`);
      // ownership: after deleting the accessor there is NO classic binding behind the name (LAST step: destroys the accessor)
      const own = await page.evaluate(() => {
        const out = {};
        try { out.deleteResult = delete window.agentOrder; } catch (e) { out.deleteError = String(e); }
        try { out.afterDeleteTypeof = typeof agentOrder; } catch (e) { out.afterDeleteTypeof = 'THROWS'; }
        try { void agentOrder; out.readThrows = false; } catch (e) { out.readThrows = e && e.name === 'ReferenceError'; }
        return out;
      });
      ps('AC2-ownership-after-deleting-the-accessor-the-bare-name-is-a-ReferenceError', own.deleteResult === true && own.afterDeleteTypeof === 'undefined' && own.readThrows === true, JSON.stringify(own));
    } finally { await ctx.close(); }
  }

  fingerprint.scriptRequests = [...scriptRequests].sort();
  valid('no-uncaught-page-errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  await browser.close();

  // ================= verdict =================
  const by = (k) => checks.filter((c) => c.kind === k);
  const cnt = (k) => `${by(k).filter((c) => c.ok).length}/${by(k).length}`;
  const invalid = by('VALID').some((c) => !c.ok);
  const rejected = !invalid && checks.some((c) => !c.ok);
  const verdict = invalid ? 'INVALID' : rejected ? 'REJECTED' : 'ACCEPTED';
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n=== SUMMARY ===\n${checks.filter((c) => c.ok).length}/${checks.length} checks passed  (VALID ${cnt('VALID')}, PRES ${cnt('PRES')}, PS ${cnt('PS')})`);
  if (failed.length) console.log('FAILED: ' + failed.map((c) => `[${c.kind}] ${c.name}`).join('\n        '));
  console.log(`S10-VERDICT = ${verdict}  (chromium ${chromiumVersion}; frontend=${path.relative(HERE, FRONTEND_DIR) || '.'})`);
  await writeFile(RESULTS_FILE, JSON.stringify({ slice: 'core-10', subject: 'agentOrder global accessor (CP-18 / ADR-005)', chromium: chromiumVersion, verdict, frontendSha256: fileHashes,
    counts: { VALID: cnt('VALID'), PRES: cnt('PRES'), PS: cnt('PS') }, failed: failed.map((c) => `[${c.kind}] ${c.name}`), fingerprint, checks }, null, 2) + '\n');
  console.log(`results -> ${RESULTS_FILE}`);
  process.exitCode = verdict === 'ACCEPTED' ? 0 : verdict === 'REJECTED' ? 1 : 3;
} catch (e) {
  console.log(`[FAIL] [VALID] script-crashed — ${e && e.stack ? e.stack : e}`);
  try { if (browser) await browser.close(); } catch {}
  console.log('\n=== SUMMARY ===\nscript crashed before completion\nS10-VERDICT = INVALID');
  process.exitCode = 2;
}
