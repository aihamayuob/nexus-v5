/* ==========================================================================
   baseline/evidence/phase2-core-slice5-mutation-script.mjs
   Core slice 5 (evidence-only) — proves e2e/phase2-core-slice5-flows.mjs CAN
   DISCRIMINATE: the same script is pointed (NEXUS_FRONTEND_DIR) at three SCRATCH
   COPIES of frontend/ (in os.tmpdir(), deleted afterwards). Production files are
   never edited; their sha256 is checked before and after.

     M1  scratch-only "fix" experiment: main.js awaits autoInitApp() before
         updateOnlineStatus()            -> expected verdict SURVIVES, validity 27/27
     M2  sabotage: restorePersistableState wrapper is a no-op
                                          -> expected INCONCLUSIVE (restore-ran checks FAIL)
     M3  sabotage: updateOnlineStatus no longer logs the offline entry
                                          -> expected INCONCLUSIVE (positive control FAILS)
   M1 is NOT a proposal and NOT applied: it only shows the test reports the
   opposite outcome when the order really changes. Run:  node <this file>
   Needs the E2E environment (playwright in e2e/node_modules, Chromium).
   ========================================================================== */
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const FRONTEND = path.join(REPO, 'frontend');
const E2E = path.join(REPO, 'e2e', 'phase2-core-slice5-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.NEXUS_S5_MUT_RESULTS || path.join(HERE, 'phase2-core-slice5-mutation-results.json');

function treeHash(dir) { // sha256 over (relative path + file sha256) of every file, excluding node_modules/coverage
  const h = createHash('sha256');
  const walk = (d) => readdirSync(d).sort().forEach((n) => {
    if (n === 'node_modules' || n === 'coverage') return;
    const p = path.join(d, n);
    if (statSync(p).isDirectory()) return walk(p);
    h.update(path.relative(dir, p) + '\0' + createHash('sha256').update(readFileSync(p)).digest('hex') + '\n');
  });
  walk(dir);
  return h.digest('hex');
}
function patch(file, oldText, newText) {
  const s = readFileSync(file, 'utf8');
  const n = s.split(oldText).length - 1;
  if (n !== 1) throw new Error(`anchor must occur exactly once in ${file} (found ${n}): ${oldText.slice(0, 60)}`);
  writeFileSync(file, s.replace(oldText, newText));
}

// Slice 6 note: after the O2 patch main.js no longer contains the original 3-line block, so M1 is defined relative to
// the tree it runs on. PRE-slice-6 tree: the original scratch reorder experiment (expects SURVIVES). POST-slice-6 tree
// (main.js contains the `bootInit.finally(...)` call): the inverse experiment — revert to the original sequential call —
// must bring the I-1 loss back (expects LOST), which proves this script still discriminates after the patch.
const S6_CALL = 'bootInit.finally(() => window.updateOnlineStatus());';
const POST_S6 = readFileSync(path.join(FRONTEND, 'main.js'), 'utf8').includes(S6_CALL);
const M1 = POST_S6
  ? { id: 'M1', desc: 'post-slice-6 revert: sequential window.updateOnlineStatus() (undoes O2) -> loss returns', file: 'main.js',
      old: S6_CALL, neu: 'window.updateOnlineStatus();', expect: { verdict: 'LOST', exit: 0 } }
  : { id: 'M1', desc: 'scratch-only reorder: await autoInitApp() before updateOnlineStatus()', file: 'main.js',
      old: 'window.autoInitApp();\nwindow.registerServiceWorker();\nwindow.updateOnlineStatus();',
      neu: 'await window.autoInitApp();\nwindow.registerServiceWorker();\nwindow.updateOnlineStatus();',
      expect: { verdict: 'SURVIVES', exit: 0 } };
const MUTANTS = [
  M1,
  { id: 'M2', desc: 'sabotage: restorePersistableState wrapper is a no-op', file: HTML,
    old: 'function restorePersistableState(decrypted){ PersistableStateCore.restorePersistableState(PERSISTABLE_STATE, decrypted); }',
    neu: 'function restorePersistableState(decrypted){ /* M2 sabotage */ }',
    expect: { verdict: 'INCONCLUSIVE', exit: 1, mustFail: ['C0-online-boot-restore-ran-and-activityLog-restored-exactly'] } },
  { id: 'M3', desc: 'sabotage: updateOnlineStatus does not log the offline entry', file: HTML,
    old: "    logActivity('انقطع الاتصال', 'وضع عدم الاتصال مفعّل');",
    neu: '    /* M3 sabotage */',
    expect: { verdict: 'INCONCLUSIVE', exit: 1, mustFail: ['C1-POSITIVE-CONTROL-offline-entry-written-and-visible'] } },
];

const before = treeHash(FRONTEND);
const rows = [];
for (const m of MUTANTS) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `nexus-s5-${m.id}-`));
  const copy = path.join(tmp, 'frontend');
  const resultsFile = path.join(tmp, 'results.json');
  try {
    cpSync(FRONTEND, copy, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes(`${path.sep}coverage`) });
    patch(path.join(copy, m.file), m.old, m.neu);
    const r = spawnSync('node', [E2E], { env: { ...process.env, NEXUS_FRONTEND_DIR: copy, NEXUS_S5_RESULTS: resultsFile }, encoding: 'utf8', timeout: 300000 });
    const res = JSON.parse(readFileSync(resultsFile, 'utf8'));
    const failed = res.validity.failed;
    const ok = res.verdict === m.expect.verdict && r.status === m.expect.exit && (m.expect.mustFail || []).every((n) => failed.includes(n));
    rows.push({ id: m.id, desc: m.desc, expected: m.expect, verdict: res.verdict, exit: r.status, validity: `${res.validity.passed}/${res.validity.total}`, failedChecks: failed, matchesExpectation: ok });
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${m.id} ${m.desc} -> verdict=${res.verdict} exit=${r.status} validity=${res.validity.passed}/${res.validity.total} failed=${failed.length}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const after = treeHash(FRONTEND);
const untouched = before === after;
console.log(`${untouched ? '[PASS]' : '[FAIL]'} production frontend/ tree sha256 unchanged (${before.slice(0, 16)}… -> ${after.slice(0, 16)}…)`);
const allOk = untouched && rows.every((r) => r.matchesExpectation);
writeFileSync(OUT, JSON.stringify({ slice: 'core-5', frontendTreeSha256Before: before, frontendTreeSha256After: after, productionUntouched: untouched, mutants: rows, allMutantsBehavedAsExpected: allOk }, null, 2) + '\n');
console.log(`\n=== SUMMARY ===\n${rows.filter((r) => r.matchesExpectation).length}/${rows.length} mutants behaved as expected; production untouched=${untouched}`);
process.exitCode = allOk ? 0 : 1;
