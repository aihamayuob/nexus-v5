/* ==========================================================================
   e2e/phase2-core-slice4-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9
   "core", TARGET SLICE 4 / candidate C1: registry-parameter
   snapshotPersistableState / restorePersistableState / resetPersistableState.

   Real Chromium against the real HTML + real modules (no mocks). The point of
   this suite is to prove the extraction THROUGH THE REAL APP PATHS, not by
   calling the extracted function alone:

     snapshot : persistState() -> snapshotPersistableState() -> encryptState -> localStore
     restore  : reload -> autoInitApp() -> decryptState -> restorePersistableState()
     reset    : resetAllData() -> resetPersistableState()

   autoInitApp() swallows decrypt errors ("starting fresh"), so every check
   asserts the restored DATA (all 16 persisted variables), never the mere
   absence of errors.

   Two checks are patch-specific and are EXPECTED TO FAIL on the pre-extraction
   tree (the logic lived in the classic script, there was no bridge):
     - bridge-core-namespace
     - wrappers-delegate-explicit-registry
   Every other check is behavior-only and must PASS on BOTH sides — that is the
   behavior-equivalence evidence (run once on the unpatched tree, once after).

   The script reports failures; it must not crash (a crash is detection, not
   evidence): every in-page block is wrapped and returns its error.
   ========================================================================== */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const FRONTEND_DIR = new URL('../frontend', import.meta.url).pathname;
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const STATIC_PORT = 8924;
const KEYS16 = [
  'messages', 'selectedAgentIds', 'knowledgeBase', 'activityLog', 'customAgents', 'longTermMemory', 'workflows',
  'agentOrder', 'usageLog', 'errorLog', 'activeGroupId', 'uploadedDocs', 'projects', 'decisionJournal',
  'topicMonitors', 'briefingLastSeenAt',
];
const LOG_LIKE = ['activityLog', 'errorLog']; // the app may append to these after boot -> "contains marker"

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
let browser = null;
let page = null;

async function waitForInit() {
  try {
    await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
    return true;
  } catch { return false; }
}
async function reloadAndWaitFor(markerExpr, arg) {
  await page.reload({ waitUntil: 'networkidle' });
  const inited = await waitForInit();
  let restored = false;
  try { await page.waitForFunction(markerExpr, arg, { timeout: 15000 }); restored = true; } catch { restored = false; }
  return { inited, restored };
}

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext();
  page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${STATIC_PORT}/`, { waitUntil: 'networkidle' });
  const inited = await waitForInit();
  log('page-load-and-init', inited && pageErrors.length === 0, `inited=${inited} pageErrors=${pageErrors.length}`);

  // ---- 1. the three names still exist, as classic functions with the ORIGINAL signatures ----
  const present = await page.evaluate(() => {
    try {
      return {
        snap: typeof snapshotPersistableState, restore: typeof restorePersistableState, reset: typeof resetPersistableState,
        arity: [snapshotPersistableState.length, restorePersistableState.length, resetPersistableState.length].join('/'),
        onWindow: [typeof window.snapshotPersistableState, typeof window.restorePersistableState, typeof window.resetPersistableState].join('/'),
        registryKeys: Object.keys(PERSISTABLE_STATE).length,
      };
    } catch (e) { return { error: String(e) }; }
  });
  log('wrappers-present-original-signatures',
    present.snap === 'function' && present.restore === 'function' && present.reset === 'function' &&
    present.arity === '0/1/0' && present.registryKeys === 16 && present.onWindow === 'function/function/function',
    JSON.stringify(present));

  // ---- 2. PATCH-SPECIFIC: the bridge exposes the module's pure functions ----
  const bridge = await page.evaluate(async () => {
    try {
      const mod = await import('/modules/storage.mjs');
      const c = window.PersistableStateCore;
      const names = ['snapshotPersistableState', 'restorePersistableState', 'resetPersistableState'];
      return {
        hasCore: !!c,
        keys: c ? Object.keys(c).sort().join(',') : null,
        sameAsModule: !!c && names.every((n) => typeof mod[n] === 'function' && c[n] === mod[n]),
        pureArity: names.map((n) => mod[n] && mod[n].length).join('/'),
        wrappersAreNotTheModuleFns: names.every((n) => window[n] !== mod[n]),
      };
    } catch (e) { return { error: String(e) }; }
  });
  log('bridge-core-namespace',
    bridge.hasCore === true && bridge.sameAsModule === true && bridge.pureArity === '1/2/1' && bridge.wrappersAreNotTheModuleFns === true,
    `(patch-specific; expected FAIL pre-extraction) ${JSON.stringify(bridge)}`);

  // ---- 3. seed distinctive values for ALL 16 persisted variables (via the real registry setters) ----
  const MARK = 'S4-' + Date.now();
  const seeded = await page.evaluate((MARK) => {
    try {
      const iso = '2001-02-03T04:05:06.000Z';
      const values = {
        messages: [{ role: 'user', agentId: null, agentName: 'أنت', content: MARK + '-msg', type: 'text' }],
        selectedAgentIds: ['general', 'custom_s4'],
        knowledgeBase: [{ id: 'kb_s4', title: MARK + '-kb', content: 'c' }],
        activityLog: [{ ts: iso, action: MARK + '-act', detail: 'd' }],
        customAgents: [{ id: 'custom_s4', emoji: '🧪', name: MARK + '-agent', prompt: 'p', knowledge: [], createdAt: iso }],
        longTermMemory: [{ id: 'ltm_s4', text: MARK + '-ltm', embedding: [0.1, 0.2], ts: iso, agentId: 'general' }],
        workflows: [{ id: 'wf_s4', name: MARK + '-wf', steps: [] }],
        agentOrder: ['custom_s4', 'general'],
        usageLog: [{ ts: 1, provider: 'anthropic', inputTokens: 1, outputTokens: 2, cost: 0.5, latencyMs: 3 }],
        errorLog: [{ ts: 1, message: MARK + '-err', detail: '' }],
        activeGroupId: Object.keys(NexusRegistry.domains.all())[0],
        uploadedDocs: [{ id: 'doc_s4', filename: MARK + '.txt', sizeKB: 1, chunks: [] }],
        projects: [{ id: 'proj_s4', name: MARK + '-proj', icon: '📁', description: '', createdAt: iso }],
        decisionJournal: [{ id: 'dj_s4', status: 'reviewed', title: MARK + '-dj' }],
        topicMonitors: [{ id: 'mon_s4', topic: MARK + '-topic', question: 'q', agentId: 'general', projectId: null, createdAt: iso, lastCheckedAt: null, history: [], unacknowledged: false }],
        briefingLastSeenAt: iso,
      };
      for (const k of Object.keys(values)) PERSISTABLE_STATE[k].set(values[k]);
      return { ok: true, values };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, MARK);
  log('seed-16-variables', seeded.ok === true && Object.keys(seeded.values || {}).length === 16, seeded.ok ? '16 keys seeded through PERSISTABLE_STATE setters' : seeded.error);
  const VALUES = seeded.values || {};

  // ---- 4. snapshot through the real wrapper: shape, isolation, no state change ----
  const snapCheck = await page.evaluate(() => {
    try {
      const before = JSON.stringify(snapshotPersistableState());
      const s1 = snapshotPersistableState();
      const s2 = snapshotPersistableState();
      const out = {
        keysEqualRegistry: Object.keys(s1).join(',') === Object.keys(PERSISTABLE_STATE).join(','),
        distinctObjects: s1 !== s2,
        liveRefs: s1.messages === messages && s1.knowledgeBase === knowledgeBase, // existing shallow behavior (characterization)
      };
      const heldMessages = messages;
      delete s1.messages;
      s1.knowledgeBase = ['REPLACED-IN-SNAPSHOT'];
      s1.rogue = 1;
      out.stateUntouchedByMutatingSnapshot = JSON.stringify(snapshotPersistableState()) === before && messages === heldMessages;
      return out;
    } catch (e) { return { error: String(e) }; }
  });
  log('snapshot-shape-and-top-level-isolation',
    snapCheck.keysEqualRegistry === true && snapCheck.distinctObjects === true && snapCheck.stateUntouchedByMutatingSnapshot === true,
    JSON.stringify(snapCheck));
  log('snapshot-values-are-live-references (characterization of existing behavior)', snapCheck.liveRefs === true,
    'shallow snapshot preserved byte-for-byte; not a new guarantee');

  // ---- 5. REAL persist -> reload -> autoInitApp restore of ALL 16 variables ----
  const persistRun = await page.evaluate(async () => {
    try { await persistState(); return 'ok'; } catch (e) { return 'crashed: ' + e; }
  });
  log('persist-call-completed', persistRun === 'ok', persistRun);

  const wait1 = await reloadAndWaitFor((m) => messages.some((x) => x && x.content === m), MARK + '-msg');
  log('state-restored-after-reload (marker via real autoInitApp)', wait1.inited && wait1.restored, `inited=${wait1.inited} restored=${wait1.restored}`);
  const restoreAll = await page.evaluate(({ values, keys, logLike }) => {
    try {
      const bad = [];
      for (const k of keys) {
        const live = PERSISTABLE_STATE[k].get();
        if (logLike.includes(k)) {
          const needle = JSON.stringify(values[k][0]);
          if (!Array.isArray(live) || !live.some((e) => JSON.stringify(e) === needle)) bad.push(k);
        } else if (JSON.stringify(live) !== JSON.stringify(values[k])) bad.push(k);
      }
      return { bad };
    } catch (e) { return { error: String(e), bad: ['<crashed>'] }; }
  }, { values: VALUES, keys: KEYS16, logLike: LOG_LIKE });
  log('all-16-variables-restored-via-autoInitApp', restoreAll.bad.length === 0, restoreAll.error || `mismatching=[${restoreAll.bad.join(',')}]`);

  // ---- 6. missing keys through the REAL autoInitApp: fresh, independent defaults ----
  const MISSING = ['knowledgeBase', 'selectedAgentIds', 'activeGroupId', 'briefingLastSeenAt', 'customAgents', 'agentOrder'];
  const craft = await page.evaluate(async (missing) => {
    try {
      const snap = snapshotPersistableState();
      for (const k of missing) delete snap[k];
      const payload = await encryptState(snap, encryptionKey);
      await localStore.set(STORAGE_KEY, JSON.stringify(payload));
      return { ok: true, remaining: Object.keys(snap).length };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, MISSING);
  log('crafted-blob-without-6-keys-written', craft.ok === true && craft.remaining === 10, craft.ok ? `remaining keys=${craft.remaining}` : craft.error);

  const wait2 = await reloadAndWaitFor((m) => messages.some((x) => x && x.content === m), MARK + '-msg');
  log('crafted-blob-restored-via-autoInitApp', wait2.inited && wait2.restored, `inited=${wait2.inited} restored=${wait2.restored}`);
  const missingCheck = await page.evaluate(({ values, keys, logLike, missing }) => {
    try {
      const out = { defaultsOk: [], keptBad: [] };
      for (const k of missing) {
        const live = PERSISTABLE_STATE[k].get();
        if (JSON.stringify(live) === JSON.stringify(PERSISTABLE_STATE[k].default())) out.defaultsOk.push(k);
      }
      out.expectedDefaults = {
        knowledgeBase: JSON.stringify(knowledgeBase) === '[]',
        selectedAgentIds: JSON.stringify(selectedAgentIds) === '["general"]',
        activeGroupId: activeGroupId === null,
        briefingLastSeenAt: briefingLastSeenAt === null,
        customAgents: JSON.stringify(customAgents) === '[]',
        agentOrder: JSON.stringify(agentOrder) === '[]',
      };
      for (const k of keys.filter((x) => !missing.includes(x))) {
        const live = PERSISTABLE_STATE[k].get();
        if (logLike.includes(k)) {
          const needle = JSON.stringify(values[k][0]);
          if (!Array.isArray(live) || !live.some((e) => JSON.stringify(e) === needle)) out.keptBad.push(k);
        } else if (JSON.stringify(live) !== JSON.stringify(values[k])) out.keptBad.push(k);
      }
      return out;
    } catch (e) { return { error: String(e) }; }
  }, { values: VALUES, keys: KEYS16, logLike: LOG_LIKE, missing: MISSING });
  const expectedOk = missingCheck.expectedDefaults && Object.values(missingCheck.expectedDefaults).every(Boolean);
  log('missing-keys-restored-to-their-defaults', !!expectedOk && missingCheck.defaultsOk.length === MISSING.length, JSON.stringify(missingCheck.expectedDefaults || missingCheck));
  log('present-keys-kept-when-others-missing', Array.isArray(missingCheck.keptBad) && missingCheck.keptBad.length === 0, `mismatching=[${(missingCheck.keptBad || []).join(',')}]`);

  const indep = await page.evaluate(() => {
    try {
      const kb = knowledgeBase, ca = customAgents, ao = agentOrder, sel = selectedAgentIds;
      const out = { distinct: kb !== ca && ca !== ao && kb !== ao };
      kb.push('POLLUTION');
      sel.push('POLLUTION');
      out.siblingsUnaffected = ca.length === 0 && ao.length === 0;
      out.nextDefaultsClean = JSON.stringify(PERSISTABLE_STATE.knowledgeBase.default()) === '[]' &&
        JSON.stringify(PERSISTABLE_STATE.selectedAgentIds.default()) === '["general"]';
      out.defaultIsFreshObject = PERSISTABLE_STATE.knowledgeBase.default() !== kb && PERSISTABLE_STATE.selectedAgentIds.default() !== sel;
      return out;
    } catch (e) { return { error: String(e) }; }
  });
  log('restored-defaults-are-independent-fresh-objects',
    indep.distinct === true && indep.siblingsUnaffected === true && indep.nextDefaultsClean === true && indep.defaultIsFreshObject === true,
    JSON.stringify(indep));

  // ---- 7a. real wrappers: restore(self) is a no-op on values; reset installs fresh defaults and REBINDS ----
  const realReset = await page.evaluate(() => {
    try {
      const heldKB = knowledgeBase, heldSel = selectedAgentIds; // both polluted by the previous check
      const before = JSON.stringify(snapshotPersistableState());
      const snap = snapshotPersistableState();
      restorePersistableState(snap);
      const out = { restoreSelfIsNoop: JSON.stringify(snapshotPersistableState()) === before };
      resetPersistableState();
      out.allDefaultsAfterReset = Object.keys(PERSISTABLE_STATE).every((k) => JSON.stringify(PERSISTABLE_STATE[k].get()) === JSON.stringify(PERSISTABLE_STATE[k].default()));
      out.rebinds = knowledgeBase !== heldKB && selectedAgentIds !== heldSel;
      out.heldArraysKeepContents = heldKB.includes('POLLUTION') && heldSel.includes('POLLUTION');
      out.selectedDefault = JSON.stringify(selectedAgentIds) === '["general"]';
      return out;
    } catch (e) { return { error: String(e) }; }
  });
  log('real-restore-self-noop-and-reset-sets-all-16-defaults-and-rebinds',
    realReset.restoreSelfIsNoop === true && realReset.allDefaultsAfterReset === true && realReset.rebinds === true &&
    realReset.heldArraysKeepContents === true && realReset.selectedDefault === true,
    JSON.stringify(realReset));

  // ---- 7b. PATCH-SPECIFIC: wrappers delegate to the bridge with the SAME registry object ----
  const delegate = await page.evaluate(() => {
    try {
      const c = window.PersistableStateCore;
      if (!c) return { error: 'window.PersistableStateCore is missing' };
      const orig = { s: c.snapshotPersistableState, r: c.restorePersistableState, z: c.resetPersistableState };
      const calls = [];
      c.snapshotPersistableState = (...a) => { calls.push(['snapshot', a]); return orig.s(...a); };
      c.restorePersistableState = (...a) => { calls.push(['restore', a]); return orig.r(...a); };
      c.resetPersistableState = (...a) => { calls.push(['reset', a]); return orig.z(...a); };
      let out;
      try {
        const snap = snapshotPersistableState();
        restorePersistableState(snap);
        resetPersistableState();
        out = {
          snapshotArgs: !!calls[0] && calls[0][0] === 'snapshot' && calls[0][1].length === 1 && calls[0][1][0] === PERSISTABLE_STATE,
          restoreArgs: !!calls[1] && calls[1][0] === 'restore' && calls[1][1].length === 2 && calls[1][1][0] === PERSISTABLE_STATE && calls[1][1][1] === snap,
          resetArgs: !!calls[2] && calls[2][0] === 'reset' && calls[2][1].length === 1 && calls[2][1][0] === PERSISTABLE_STATE,
          callCount: calls.length,
        };
      } finally {
        c.snapshotPersistableState = orig.s; c.restorePersistableState = orig.r; c.resetPersistableState = orig.z;
      }
      return out;
    } catch (e) { return { error: String(e) }; }
  });
  log('wrappers-delegate-explicit-registry',
    delegate.snapshotArgs === true && delegate.restoreArgs === true && delegate.resetArgs === true && delegate.callCount === 3,
    `(patch-specific; expected FAIL pre-extraction) ${JSON.stringify(delegate)}`);

  // ---- 8. the REAL resetAllData() path (inline-handler entry point) ----
  const reseed = await page.evaluate(async (values) => {
    try {
      for (const k of Object.keys(values)) PERSISTABLE_STATE[k].set(values[k]);
      await persistState();
      const res = await localStore.get(STORAGE_KEY);
      return { blobBefore: !!(res && res.value) };
    } catch (e) { return { error: String(e) }; }
  }, VALUES);
  page.once('dialog', (d) => d.accept());
  const resetRun = await page.evaluate(async () => {
    try {
      await resetAllData();
      const out = { allDefaults: Object.keys(PERSISTABLE_STATE).every((k) => JSON.stringify(PERSISTABLE_STATE[k].get()) === JSON.stringify(PERSISTABLE_STATE[k].default())) };
      try { await localStore.get(STORAGE_KEY); out.blobGone = false; } catch { out.blobGone = true; }
      return out;
    } catch (e) { return { error: String(e) }; }
  });
  log('resetAllData-real-path-wipes-state-and-blob', reseed.blobBefore === true && resetRun.allDefaults === true && resetRun.blobGone === true,
    JSON.stringify({ reseed, resetRun }));

  await page.reload({ waitUntil: 'networkidle' });
  const inited3 = await waitForInit();
  const afterReset = await page.evaluate(() => {
    try {
      return { allDefaults: Object.keys(PERSISTABLE_STATE).every((k) => JSON.stringify(PERSISTABLE_STATE[k].get()) === JSON.stringify(PERSISTABLE_STATE[k].default())), messages: messages.length };
    } catch (e) { return { error: String(e) }; }
  });
  log('no-resurrection-after-reset-and-reload', inited3 && afterReset.allDefaults === true, JSON.stringify({ inited3, afterReset }));

  const decErr = consoleErrors.filter((t) => /Decrypt error|persist failed|Key import error/.test(t));
  log('no-decrypt-or-persist-errors', decErr.length === 0, decErr.join(' | ').slice(0, 200));
  log('no-page-errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
} catch (e) {
  log('suite-ran-to-completion', false, 'unexpected crash: ' + String(e).slice(0, 300));
} finally {
  try { if (browser) await browser.close(); } catch { /* ignore */ }
  staticServer.close();
}

const failed = results.filter((r) => !r.ok);
console.log('\n=== SUMMARY ===');
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(', '));
process.exit(failed.length ? 1 : 0);
