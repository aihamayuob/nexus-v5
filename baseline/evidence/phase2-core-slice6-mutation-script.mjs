/* ==========================================================================
   baseline/evidence/phase2-core-slice6-mutation-script.mjs
   Core slice 6 (I-1 / O2) — proves e2e/phase2-core-slice6-flows.mjs CAN DISCRIMINATE.
   The acceptance script is pointed (NEXUS_FRONTEND_DIR) at SCRATCH COPIES of frontend/
   (os.tmpdir(), deleted afterwards); production files are never edited and their sha256
   is checked before and after. Every mutant must be rejected (verdict != ACCEPTED, exit != 0)
   AND the specific check named in `mustFail` must be among the failing ones.

     K1  revert to the pre-patch sequential call           window.updateOnlineStatus();
     K2  `.then` instead of `.finally`                      (rejection skips the call)
     K3  the call is dropped entirely
     K4  registerServiceWorker() moved behind init          (SW registration delayed)
     K5  rejection handled/swallowed                        `.then(f, f)`
     K6  naive top-level await                              `await bootInit; window.updateOnlineStatus();`
   Run:  node <this file>   (needs the E2E environment: playwright in e2e/node_modules, Chromium; ~6-8 min)
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
const E2E = path.join(REPO, 'e2e', 'phase2-core-slice6-flows.mjs');
const OUT = process.env.NEXUS_S6_MUT_RESULTS || path.join(HERE, 'phase2-core-slice6-mutation-results.json');

function treeHash(dir) {
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
function patchAll(file, edits) {
  let s = readFileSync(file, 'utf8');
  for (const [oldText, newText] of edits) {
    const n = s.split(oldText).length - 1;
    if (n !== 1) throw new Error(`anchor must occur exactly once in ${file} (found ${n}): ${oldText.slice(0, 70)}`);
    s = s.replace(oldText, () => newText);
  }
  writeFileSync(file, s);
}

const CALL = 'bootInit.finally(() => window.updateOnlineStatus());';
const SW = 'window.registerServiceWorker();\n';
const MUTANTS = [
  { id: 'K1', desc: 'revert to sequential window.updateOnlineStatus()', edits: [[CALL, 'window.updateOnlineStatus();']],
    mustFail: ['AC1-final-activityLog=', 'AC7-offline-entry-written-AFTER-restore-end', 'AC5-event-inside-init-window'] },
  { id: 'K2', desc: '.then instead of .finally (rejection skips the call)', edits: [[CALL, 'bootInit.then(() => window.updateOnlineStatus());']],
    mustFail: ['AC6-updateOnlineStatus-STILL-runs-when-autoInitApp-rejects'] },
  { id: 'K3', desc: 'updateOnlineStatus call dropped', edits: [[CALL, 'bootInit.finally(() => {});']],
    mustFail: ['AC1-plain-offline-boots-valid-and-seed-persisted', 'AC6-updateOnlineStatus-STILL-runs-when-autoInitApp-rejects'] },
  { id: 'K4', desc: 'registerServiceWorker moved behind init', edits: [[SW, ''], [CALL, 'bootInit.finally(() => { window.registerServiceWorker(); window.updateOnlineStatus(); });']],
    mustFail: ['AC7-serviceWorker.register-called-before-restore-begin'] },
  { id: 'K5', desc: 'rejection swallowed (.then(f, f))', edits: [[CALL, 'bootInit.then(() => window.updateOnlineStatus(), () => window.updateOnlineStatus());']],
    mustFail: ['AC6-rejection-still-reported-as-unhandled-rejection'] },
  { id: 'K6', desc: 'naive top-level await bootInit; updateOnlineStatus()', edits: [[CALL, 'await bootInit;\nwindow.updateOnlineStatus();']],
    mustFail: ['AC6-updateOnlineStatus-STILL-runs-when-autoInitApp-rejects'] },
];

const before = treeHash(FRONTEND);
if (!readFileSync(path.join(FRONTEND, 'main.js'), 'utf8').includes(CALL)) {
  console.log('[FAIL] production main.js does not contain the slice 6 patch; this script mutates the PATCHED tree.');
  process.exit(2);
}
const rows = [];
for (const m of MUTANTS) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `nexus-s6-${m.id}-`));
  const copy = path.join(tmp, 'frontend');
  const resultsFile = path.join(tmp, 'results.json');
  try {
    cpSync(FRONTEND, copy, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes(`${path.sep}coverage`) });
    patchAll(path.join(copy, 'main.js'), m.edits);
    const r = spawnSync('node', [E2E], { env: { ...process.env, NEXUS_FRONTEND_DIR: copy, NEXUS_S6_RESULTS: resultsFile }, encoding: 'utf8', timeout: 280000 });
    const res = JSON.parse(readFileSync(resultsFile, 'utf8'));
    const failedNames = res.checks.filter((c) => !c.ok).map((c) => c.name);
    const caught = res.verdict !== 'ACCEPTED' && r.status !== 0;
    const mustOk = m.mustFail.every((p) => failedNames.some((n) => n.startsWith(p)));
    const ok = caught && mustOk;
    rows.push({ id: m.id, desc: m.desc, verdict: res.verdict, exit: r.status, failedCount: failedNames.length, mustFail: m.mustFail, mustFailAllPresent: mustOk, caught, matchesExpectation: ok, failedChecks: failedNames });
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${m.id} ${m.desc} -> verdict=${res.verdict} exit=${r.status} failedChecks=${failedNames.length} mustFailPresent=${mustOk}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
const after = treeHash(FRONTEND);
const untouched = before === after;
console.log(`${untouched ? '[PASS]' : '[FAIL]'} production frontend/ tree sha256 unchanged (${before.slice(0, 16)}… -> ${after.slice(0, 16)}…)`);
const allOk = untouched && rows.every((r) => r.matchesExpectation);
writeFileSync(OUT, JSON.stringify({ slice: 'core-6', frontendTreeSha256Before: before, frontendTreeSha256After: after, productionUntouched: untouched, mutants: rows, allMutantsCaught: allOk }, null, 2) + '\n');
console.log(`\n=== SUMMARY ===\n${rows.filter((r) => r.matchesExpectation).length}/${rows.length} mutants caught as expected; production untouched=${untouched}`);
process.exitCode = allOk ? 0 : 1;
