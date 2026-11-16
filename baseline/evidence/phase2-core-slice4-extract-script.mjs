// Core slice 4 / candidate C1 — behavior-preserving extraction of the registry-iteration logic
// (snapshotPersistableState / restorePersistableState / resetPersistableState) + byte-level proof.
//
// Usage (run from the repository root, the script is self-locating):
//   node baseline/evidence/phase2-core-slice4-extract-script.mjs apply
//        One-shot. Aborts unless the monolith, storage.mjs and main.js are byte-identical to git HEAD
//        and the original block is found EXACTLY ONCE. Writes the three files, then runs the proof.
//   node baseline/evidence/phase2-core-slice4-extract-script.mjs verify <baseRef>
//        Read-only. Re-derives every proof from `git show <baseRef>:<path>` and the working tree.
//        Writes baseline/evidence/phase2-core-slice4-extract-results.json (deterministic: no timestamps,
//        so re-running on an unchanged tree reproduces the same bytes).
//
// Nothing here moves PERSISTABLE_STATE, the 16 variables, persistState, autoInitApp or ADR-003.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HTML = 'frontend/neural_nexus_ai_agents-4-3-5-3.html';
const MOD = 'frontend/modules/storage.mjs';
const MAIN = 'frontend/main.js';
const RESULTS = path.join(ROOT, 'baseline/evidence/phase2-core-slice4-extract-results.json');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (ref, p) => git('show', `${ref}:${p}`);

// ---- the ORIGINAL block, verbatim from HEAD 9c95fbd (monolith L4953-4966) ----------------------
export const ORIGINAL =
`function snapshotPersistableState(){
  const snap = {};
  for(const key in PERSISTABLE_STATE) snap[key] = PERSISTABLE_STATE[key].get();
  return snap;
}
function restorePersistableState(decrypted){
  for(const key in PERSISTABLE_STATE){
    const entry = PERSISTABLE_STATE[key];
    entry.set(decrypted && decrypted[key] !== undefined ? decrypted[key] : entry.default());
  }
}
function resetPersistableState(){
  for(const key in PERSISTABLE_STATE) PERSISTABLE_STATE[key].set(PERSISTABLE_STATE[key].default());
}
`;

// ---- forward transform T(O): the ONLY edits allowed on the way into the module -----------------
function forward(o) {
  return o
    .replace(/\bfunction (snapshotPersistableState|resetPersistableState)\(\)/g, 'export function $1(registry)')
    .replace('function restorePersistableState(decrypted)', 'export function restorePersistableState(registry, decrypted)')
    .replace(/\bPERSISTABLE_STATE\b/g, 'registry');
}
// ---- reverse transform R(M): must give O back byte-for-byte ------------------------------------
function reverse(m) {
  return m
    .replace(/\bexport function /g, 'function ')
    .replace(/\bregistry\b/g, 'PERSISTABLE_STATE')
    .replace('function snapshotPersistableState(PERSISTABLE_STATE)', 'function snapshotPersistableState()')
    .replace('function resetPersistableState(PERSISTABLE_STATE)', 'function resetPersistableState()')
    .replace('function restorePersistableState(PERSISTABLE_STATE, decrypted)', 'function restorePersistableState(decrypted)');
}
export const MODULE_CODE = forward(ORIGINAL);

const SECTION_HEADER =
`
// ---- Persistable-state registry iteration (Phase 2 boundary "core", slice 4 / C1) -----------------
// The ONLY logic moved: the three functions that iterate a { get, set, default } registry. The registry
// itself (PERSISTABLE_STATE) and the 16 variables it wraps stay in the classic script — ADR-003 is
// unchanged, they cannot move without a state-ownership decision — and the registry is passed in
// EXPLICITLY, so nothing here names or reads a global. Bodies = the original text with \`export\` added,
// the free identifier PERSISTABLE_STATE replaced by the parameter \`registry\`, and that parameter added
// to each signature (proved mechanically: baseline/evidence/phase2-core-slice4-extract-script.mjs).
// Contract preserved from the original, NOT strengthened: snapshot is shallow (values are the live
// references); restore assigns decrypted values by reference; ONLY \`undefined\` triggers entry.default(),
// which is called per missing key so every restore/reset installs a fresh object.
`;
export const MODULE_SECTION = SECTION_HEADER + MODULE_CODE;

// ---- the classic-script replacement W (keeps names + zero-registry signatures) ------------------
export const WRAPPER =
`/* MOVED (Phase 2 /nexus-modularize, boundary "core", slice 4 / C1): the registry-iteration logic of
   snapshot/restore/reset now lives in modules/storage.mjs as pure functions taking the registry as an
   explicit argument; main.js bridges them as window.PersistableStateCore. The plain names stay HERE as
   one-line wrappers with the ORIGINAL signatures, because their callers (persistState, autoInitApp,
   pushSync, pullSyncIfNewer, resolveSyncConflict, resetAllData) must not change. PERSISTABLE_STATE
   itself and the 16 variables it wraps stay in this script (ADR-003, unchanged). */
function snapshotPersistableState(){ return PersistableStateCore.snapshotPersistableState(PERSISTABLE_STATE); }
function restorePersistableState(decrypted){ PersistableStateCore.restorePersistableState(PERSISTABLE_STATE, decrypted); }
function resetPersistableState(){ PersistableStateCore.resetPersistableState(PERSISTABLE_STATE); }
`;

// ---- main.js edits (the complete, explicit list) --------------------------------------------------
const IMPORT_OLD = `import { localStore, ExecutionCheckpoint, ImageStore, MessageArchive } from './modules/storage.mjs';`;
const IMPORT_NEW = `import { localStore, ExecutionCheckpoint, ImageStore, MessageArchive, snapshotPersistableState, restorePersistableState, resetPersistableState } from './modules/storage.mjs';`;
const HEADER_OLD = `   decryptState, which live in security.mjs). See PHASE2-MODULARIZE.md for the full roadmap of what's`;
const HEADER_NEW = `   decryptState, which live in security.mjs) and its slice 4 (the registry-parameter\n   snapshot/restore/reset functions in storage.mjs, bridged as window.PersistableStateCore).\n   See PHASE2-MODULARIZE.md for the full roadmap of what's`;
const BRIDGE_ANCHOR = `window.MessageArchive = MessageArchive;\n`;
const BRIDGE_ADD =
`// Core slice 4 / C1: namespaced ON PURPOSE. The plain names snapshotPersistableState /
// restorePersistableState / resetPersistableState stay as classic wrappers in the monolith (they pass
// PERSISTABLE_STATE, so every existing zero-registry call site is unchanged); assigning the module
// functions to those same window names would replace the wrappers. See CP-11.
window.PersistableStateCore = { snapshotPersistableState, restorePersistableState, resetPersistableState };
`;

function once(hay, needle, what) {
  const n = hay.split(needle).length - 1;
  if (n !== 1) throw new Error(`${what}: expected exactly 1 occurrence, found ${n} — abort`);
}

function apply() {
  const files = { [HTML]: rd(HTML), [MOD]: rd(MOD), [MAIN]: rd(MAIN) };
  for (const p of Object.keys(files)) {
    if (files[p] !== show('HEAD', p)) throw new Error(`${p} differs from git HEAD before extraction — abort`);
  }
  once(files[HTML], ORIGINAL, 'original block in the monolith');
  once(files[MAIN], IMPORT_OLD, 'main.js import line');
  once(files[MAIN], HEADER_OLD, 'main.js header line');
  once(files[MAIN], BRIDGE_ANCHOR, 'main.js bridge anchor');
  if (!files[MOD].endsWith('\n')) throw new Error('storage.mjs does not end with a newline — abort');
  if (files[MOD].includes('PersistableState')) throw new Error('storage.mjs already mentions PersistableState — abort');

  fs.writeFileSync(path.join(ROOT, HTML), files[HTML].replace(ORIGINAL, WRAPPER));
  fs.writeFileSync(path.join(ROOT, MOD), files[MOD] + MODULE_SECTION);
  fs.writeFileSync(path.join(ROOT, MAIN),
    files[MAIN].replace(IMPORT_OLD, IMPORT_NEW).replace(HEADER_OLD, HEADER_NEW).replace(BRIDGE_ANCHOR, BRIDGE_ANCHOR + BRIDGE_ADD));
  console.log('applied: monolith block -> wrappers, storage.mjs += section, main.js import/header/bridge');
}

// ---- token-level diff (whitespace-sensitive) -----------------------------------------------------
function tokens(s) { return s.match(/[A-Za-z_$][\w$]*|\d+|\s+|[^\sA-Za-z_$\d]/g) || []; }
// Collapse the op stream into hunks separated by shared tokens.
function hunksOf(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const hunks = []; let cur = null; let i = 0, j = 0;
  const flush = () => { if (cur) { hunks.push({ del: cur.del.join(''), ins: cur.ins.join('') }); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { flush(); i++; j++; continue; }
    if (!cur) cur = { del: [], ins: [] };
    if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) cur.ins.push(b[j++]);
    else cur.del.push(a[i++]);
  }
  flush();
  return hunks;
}

function between(s, startMark, endMark, what) {
  const a = s.indexOf(startMark);
  const b = s.indexOf(endMark, a + 1);
  if (a < 0 || b < 0) throw new Error(`${what}: markers not found`);
  return s.slice(a, b);
}
const SLICES = {
  PERSISTABLE_STATE_registry: (s) => between(s, 'const PERSISTABLE_STATE = {', '\n};\n', 'registry'),
  persistState_function: (s) => between(s, 'async function persistState(){', 'async function clearConversation(){', 'persistState'),
  autoInitApp_function: (s) => between(s, 'async function autoInitApp(){', 'async function resetAllData(){', 'autoInitApp'),
  resetAllData_function: (s) => between(s, 'async function resetAllData(){', '/* ========================================================================\n   PERSISTABLE STATE REGISTRY', 'resetAllData'),
};
const VARS16 = ['messages', 'selectedAgentIds', 'knowledgeBase', 'activityLog', 'customAgents', 'longTermMemory', 'workflows', 'agentOrder', 'usageLog', 'errorLog', 'activeGroupId', 'uploadedDocs', 'projects', 'decisionJournal', 'topicMonitors', 'briefingLastSeenAt'];
function declLines(s) {
  const out = {};
  for (const v of VARS16) {
    const re = new RegExp(`^let ${v}\\b[^\\n]*$`, 'gm');
    const found = s.match(re) || [];
    out[v] = found;
  }
  return out;
}

function verify(baseRef) {
  const checks = []; const rec = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
  const base = { [HTML]: show(baseRef, HTML), [MOD]: show(baseRef, MOD), [MAIN]: show(baseRef, MAIN) };
  const cur = { [HTML]: rd(HTML), [MOD]: rd(MOD), [MAIN]: rd(MAIN) };
  const baseCommit = git('rev-parse', baseRef).trim();

  // P1 the original block exists exactly once in the BASE monolith
  const nOrig = base[HTML].split(ORIGINAL).length - 1;
  rec('P1 original block found exactly once in base monolith', nOrig === 1, `occurrences=${nOrig} sha256(O)=${sha(ORIGINAL).slice(0, 16)}…`);

  // P2 monolith: W present once; swapping W back for O reproduces the base BYTE-FOR-BYTE
  const nW = cur[HTML].split(WRAPPER).length - 1;
  // Core slice 8 later edited sendMessage() (lock/try layout). Undo exactly that block first, so this proof still checks that slice 4's
  // OWN edit to the monolith is precisely W-for-O. (No-op on trees without the slice 8 fix.)
  const S8 = [
    ["  isSendingMessage = true;\n  // BUGFIX (core slice 8): the try now starts right after the lock, so the existing catch/finally release it\n  // (and the send button) on EVERY exit — the offline early return and any failure in the preparation code\n  // (ImageStore.save, mode resolution, startTask, a missing DOM element) used to leave it set until reload.\n  let taskOutcome = 'ok'; // before the try: catch and finally use it\n  try{\n\n  if(!navigator.onLine){\n",
     "  isSendingMessage = true;\n\n  if(!navigator.onLine){\n"],
    ["\n\n  if(imageForThisMessage && (", "\n  let taskOutcome = 'ok';\n\n  if(imageForThisMessage && ("],
    ["  }\n\n    if(selectedWorkflowId){", "  }\n\n  try{\n    if(selectedWorkflowId){"],
  ];
  let curHtml = cur[HTML];
  if (curHtml.includes('BUGFIX (core slice 8)')) for (const [from, to] of S8) { if (curHtml.split(from).length - 1 === 1) curHtml = curHtml.replace(from, () => to); }
  // Evidence Integrity (CP-16) later edited the Ops Center claim form (4 hunks). Undo exactly those hunks as well (no-op on trees without them).
  const EI = [
    ["<p class=\"modal-hint\">قدّم ادّعاءً وأدلته — سيصدر حكماً مستقلاً: VERIFIED / SUPPORTED / UNCERTAIN / CONFLICTING / UNVERIFIED. حدّد نوع كل دليل صراحةً: الدليل بلا نوع معلَن لا يُحتسب دليلاً (اتفاق الوكلاء وحده لا يكفي)، ونوعه يُعلَن منك ولا يُتحقَّق منه آلياً.</p>",
     "<p class=\"modal-hint\">قدّم ادّعاءً وأدلته — سيصدر حكماً مستقلاً: VERIFIED / SUPPORTED / UNCERTAIN / CONFLICTING / UNVERIFIED.</p>"],
    ["  // Evidence Integrity (ADR-004): the kind of each evidence row is chosen EXPLICITLY — the placeholder is selected by default and is not a valid kind.\n  const kindOptions = [\n    ['INDEPENDENT_SOURCE','مصدر مستقل'], ['TOOL_RESULT','نتيجة أداة'], ['EXECUTABLE_VERIFICATION','تحقق قابل للتنفيذ'],\n    ['ENVIRONMENTAL_OBSERVATION','ملاحظة بيئية'], ['HUMAN_CONFIRMATION','تأكيد بشري صريح'], ['CONTRADICTORY_EVIDENCE','دليل متناقض (ينفي الادّعاء)']\n  ].map(k => `<option value=\"${k[0]}\">${k[1]}</option>`).join('');\n  let html = '';\n  for(let i=0;i<opsEvidenceRows;i++){\n    html += `<div style=\"display:flex; gap:6px; margin-top:6px;\">\n      <input class=\"ops-ev-source\" placeholder=\"المصدر\" style=\"flex:1;\">\n      <input class=\"ops-ev-content\" placeholder=\"محتوى الدليل\" style=\"flex:2;\">\n      <select class=\"ops-ev-kind\" style=\"flex:1;\" aria-label=\"نوع الدليل\"><option value=\"\" selected>— اختر نوع الدليل —</option>${kindOptions}</select>\n    </div>`;\n  }\n  wrap.innerHTML = html;",
     "  let html = '';\n  for(let i=0;i<opsEvidenceRows;i++){\n    html += `<div style=\"display:flex; gap:6px; margin-top:6px;\">\n      <input class=\"ops-ev-source\" placeholder=\"المصدر\" style=\"flex:1;\">\n      <input class=\"ops-ev-content\" placeholder=\"محتوى الدليل\" style=\"flex:2;\">\n    </div>`;\n  }\n  wrap.innerHTML = html;"],
    ["  const kinds = Array.from(document.querySelectorAll('.ops-ev-kind'));\n  const evidence = sources.map((s,i)=>({ source:s.value.trim(), content:contents[i].value.trim(), kind:(kinds[i] && kinds[i].value) || '' })).filter(e=>e.source && e.content);\n  const resEl = document.getElementById('opsClaimResult');\n  // Evidence Integrity (ADR-004): every entered evidence row must carry an explicitly chosen kind — nothing is sent (no silent partial send) otherwise.\n  if(evidence.some(e=>!e.kind)){\n    showToast('⚠️ اختر نوع الدليل لكل دليل مُدخَل قبل التقييم.');\n    resEl.innerHTML = '<p class=\"modal-hint\">⚠️ لم يُرسَل الطلب: كل دليل يجب أن يحمل نوعاً معلَناً صراحةً (الدليل بلا نوع لا يُحتسب).</p>';\n    return;\n  }\n  resEl.innerHTML = '<p class=\"modal-hint\">جارٍ التقييم...</p>';",
     "  const evidence = sources.map((s,i)=>({ source:s.value.trim(), content:contents[i].value.trim() })).filter(e=>e.source && e.content);\n  const resEl = document.getElementById('opsClaimResult');\n  resEl.innerHTML = '<p class=\"modal-hint\">جارٍ التقييم...</p>';"],
    ["    <div style=\"font-size:12.5px; margin-top:4px;\">${escapeHtml(c.rationale||'')}</div>\n    ${c.integrityReason ? `<div class=\"log-ts\">سبب الحالة (النزاهة): ${escapeHtml(c.integrityReason)}</div>` : ''}\n  </div>`;\n}\nasync function opsLoadClaimsList(){",
     "    <div style=\"font-size:12.5px; margin-top:4px;\">${escapeHtml(c.rationale||'')}</div>\n  </div>`;\n}\nasync function opsLoadClaimsList(){"],
  ];
  if (curHtml.includes('ops-ev-kind')) for (const [from, to] of EI) { if (curHtml.split(from).length - 1 === 1) curHtml = curHtml.replace(from, () => to); }
  // Core slice 10 (CP-18 / ADR-005) later replaced the single declaration line of `agentOrder` by a pointer comment (the value is now owned by
  // modules/state.mjs). Undo exactly that hunk as well, so this proof still checks slice 4's OWN edit. (No-op on trees without it.)
  const S10_HTML_NEW = '/* agentOrder: owned by modules/state.mjs (slice 10, ADR-005); bare name served by the window accessor installed in main.js */\n';
  const S10_HTML_OLD = 'let agentOrder = []; // array of agent ids in user-preferred display order\n';
  if (curHtml.split(S10_HTML_NEW).length - 1 === 1) curHtml = curHtml.replace(S10_HTML_NEW, () => S10_HTML_OLD);
  const restored = curHtml.replace(WRAPPER, ORIGINAL);
  rec('P2a wrapper block present exactly once in current monolith', nW === 1, `occurrences=${nW}`);
  rec('P2b current monolith with W->O equals base monolith byte-for-byte (no other byte changed)', nW === 1 && restored === base[HTML],
    `sha256(base)=${sha(base[HTML]).slice(0, 16)}… sha256(restored)=${sha(restored).slice(0, 16)}…`);
  rec('P2c the original block no longer appears in the current monolith', !cur[HTML].includes('for(const key in PERSISTABLE_STATE)'), '');

  // P3 storage.mjs = base + appended section; module code == T(O); R(M) == O (byte-exact both ways)
  const addedMod = cur[MOD].startsWith(base[MOD]) ? cur[MOD].slice(base[MOD].length) : null;
  rec('P3a storage.mjs is base + an appended section (base bytes untouched, additions only)', addedMod !== null && addedMod === MODULE_SECTION,
    `appendedBytes=${addedMod === null ? 'n/a' : addedMod.length}`);
  const modCode = addedMod === null ? '' : addedMod.slice(SECTION_HEADER.length);
  rec('P3b module code === forward(ORIGINAL) (token-exact)', modCode === forward(ORIGINAL), `sha256(module code)=${sha(modCode).slice(0, 16)}…`);
  rec('P3c reverse(module code) === ORIGINAL byte-for-byte', reverse(modCode) === ORIGINAL, `sha256(reverse)=${sha(reverse(modCode)).slice(0, 16)}… sha256(O)=${sha(ORIGINAL).slice(0, 16)}…`);

  // P4 token-level diff O -> M: only the allowed edit hunks
  const hunks = hunksOf(tokens(ORIGINAL), tokens(modCode));
  const summary = {};
  for (const h of hunks) { const k = `${JSON.stringify(h.del)} -> ${JSON.stringify(h.ins)}`; summary[k] = (summary[k] || 0) + 1; }
  const nPS = (ORIGINAL.match(/\bPERSISTABLE_STATE\b/g) || []).length;
  const allowedKeys = new Set([
    `"PERSISTABLE_STATE" -> "registry"`, `"" -> "export "`, `"" -> "registry"`, `"" -> "registry, "`,
  ]);
  const unexpected = Object.keys(summary).filter((k) => !allowedKeys.has(k));
  rec('P4 token-level diff contains only the allowed edit kinds', unexpected.length === 0 && (summary[`"PERSISTABLE_STATE" -> "registry"`] === nPS), JSON.stringify({ hunks: summary, unexpected, PERSISTABLE_STATE_occurrences_in_O: nPS }));
  rec('P4b signatures gained exactly: registry (x2: snapshot, reset) and "registry, " (x1: restore); export (x3)',
    summary['"" -> "registry"'] === 2 && summary['"" -> "registry, "'] === 1 && summary['"" -> "export "'] === 3, '');

  // P5 main.js: exactly the declared edits and nothing else
  let m = cur[MAIN];
  // Core slice 10 (CP-18 / ADR-005) added the state.mjs import line and the installGlobalStateAccessors(window) block to main.js.
  // Undo exactly those two hunks first (no-op on trees without them); the rest of this proof is unchanged.
  const S10_M_IMPORT = "import { installGlobalStateAccessors } from './modules/state.mjs';\n";
  const S10_M_BLOCK = "\n// Core slice 10 (CP-18, ADR-005): `agentOrder` is owned by modules/state.mjs; this installs window.agentOrder (accessor)\n// so the classic script's bare-name reads/writes keep working. Must stay BEFORE the startup calls below.\ninstallGlobalStateAccessors(window);\n";
  if (m.split(S10_M_IMPORT).length - 1 === 1 && m.split(S10_M_BLOCK).length - 1 === 1) m = m.replace(S10_M_IMPORT, () => '').replace(S10_M_BLOCK, () => '');
  // Slice 6 (I-1 / O2) later rewrote the 3-line startup tail of main.js. Undo exactly that block first, so this proof still
  // checks that slice 4's OWN edits to main.js are precisely {import line, header sentence, bridge}. (No-op on trees without it.)
  const S6_START = 'const bootInit = window.autoInitApp();', S6_END = 'bootInit.finally(() => window.updateOnlineStatus());';
  const i6 = m.indexOf(S6_START), j6 = m.indexOf(S6_END);
  if (i6 >= 0 && j6 > i6) m = m.slice(0, i6) + 'window.autoInitApp();\nwindow.registerServiceWorker();\nwindow.updateOnlineStatus();' + m.slice(j6 + S6_END.length);
  const okImport = m.includes(IMPORT_NEW); m = m.replace(IMPORT_NEW, IMPORT_OLD);
  const okHeader = m.includes(HEADER_NEW); m = m.replace(HEADER_NEW, HEADER_OLD);
  const okBridge = m.includes(BRIDGE_ANCHOR + BRIDGE_ADD); m = m.replace(BRIDGE_ANCHOR + BRIDGE_ADD, BRIDGE_ANCHOR);
  rec('P5 main.js = base + {import line, header sentence, bridge comment+assignment} only (reverse edits give base byte-for-byte)',
    okImport && okHeader && okBridge && m === base[MAIN], `import=${okImport} header=${okHeader} bridge=${okBridge} sha256(base)=${sha(base[MAIN]).slice(0, 16)}…`);
  const bridgeBeforeStartup = cur[MAIN].indexOf('window.PersistableStateCore = ') > 0 && cur[MAIN].indexOf('window.PersistableStateCore = ') < cur[MAIN].indexOf('window.applyTheme();') &&
    cur[MAIN].indexOf('window.PersistableStateCore = ') < cur[MAIN].indexOf('window.autoInitApp();');
  rec('P5b the bridge assignment precedes the startup calls (applyTheme … autoInitApp)', bridgeBeforeStartup, '');

  // P6 protected code: sha256 before == after (explicit; P2b already implies it for the monolith)
  const prot = {};
  let protOk = true;
  for (const [name, fn] of Object.entries(SLICES)) {
    const b = sha(fn(base[HTML])), c = sha(fn(cur[HTML]));
    prot[name] = { base: b.slice(0, 16), cur: c.slice(0, 16), same: b === c }; if (b !== c) protOk = false;
  }
  rec('P6a PERSISTABLE_STATE registry, persistState, autoInitApp, resetAllData: sha256 identical before/after', protOk, JSON.stringify(prot));
  const dB = declLines(base[HTML]), dC = declLines(curHtml); // curHtml: slice 8 / EI / slice 10 hunks undone (see P2)
  const declSame = VARS16.every((v) => dB[v].length === 1 && JSON.stringify(dB[v]) === JSON.stringify(dC[v]));
  rec('P6b the 16 `let` declaration lines: present once each and identical before/after', declSame, `declared=${VARS16.filter((v) => dB[v].length === 1).length}/16`);
  const adrSame = git('hash-object', 'ADR/003-phase2-storage-boundary.md').trim() === git('rev-parse', `${baseRef}:ADR/003-phase2-storage-boundary.md`).trim();
  rec('P6c ADR/003 unchanged (blob hash equals base)', adrSame, '');

  // P7 scope: changed paths vs base (tracked + untracked) are within the allowed set
  const changed = new Set(git('diff', '--name-only', baseRef).split('\n').filter(Boolean));
  for (const l of git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) changed.add(l);
  const allowed = [
    /^frontend\/modules\/storage\.mjs$/, /^frontend\/modules\/persistable-state\.test\.mjs$/, /^frontend\/main\.js$/,
    /^frontend\/neural_nexus_ai_agents-4-3-5-3\.html$/, /^e2e\/phase2-core-slice4-flows\.mjs$/, /^baseline\/evidence\/phase2-core-slice4-/,
    /^docs\/checkpoints\/CP-11\.md$/, /^NEXUS-CURRENT-STATE\.md$/, /^NEXUS-CONTINUATION\.md$/, /^CHANGELOG\.md$/,
  ];
  const outside = [...changed].filter((f) => !allowed.some((re) => re.test(f)));
  const touchesBackend = [...changed].some((f) => f.startsWith('src-baseline/'));
  rec('P7 changed paths are within the declared scope (nothing else touched)', outside.length === 0, JSON.stringify({ changed: [...changed].sort(), outside }));
  rec('P7b backend (src-baseline/) untouched', !touchesBackend, '');
  const otherModulesSame = ['security.mjs', 'settings.mjs', 'utilities.mjs', 'security.test.mjs', 'settings.test.mjs', 'storage.test.mjs', 'utilities.test.mjs']
    .every((f) => rd(`frontend/modules/${f}`) === show(baseRef, `frontend/modules/${f}`));
  rec('P7c the other 4 modules and the 4 existing test files are byte-identical to base', otherModulesSame, '');

  const failed = checks.filter((c) => !c.ok);
  const out = {
    slice: 'core-slice-4/C1', baseCommit, checks,
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name) },
    sha256: {
      original_block: sha(ORIGINAL), module_code: sha(MODULE_CODE), wrapper_block: sha(WRAPPER),
      base: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, sha(v)])),
      current: Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, sha(v)])),
    },
  };
  if (!process.env.NO_WRITE) fs.writeFileSync(RESULTS, JSON.stringify(out, null, 2) + '\n');
  console.log(`\n=== EXTRACTION PROOF: ${out.summary.passed}/${out.summary.total} ===`);
  if (failed.length) console.log('FAILED: ' + out.summary.failed.join(', '));
  process.exit(failed.length ? 1 : 0);
}

const [mode, arg] = process.argv.slice(2);
if (mode === 'apply') { apply(); verify(arg || 'HEAD'); }
else if (mode === 'verify') { if (!arg) throw new Error('verify needs <baseRef>'); verify(arg); }
else { console.error('usage: apply | verify <baseRef>'); process.exit(2); }
