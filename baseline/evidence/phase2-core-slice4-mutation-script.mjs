// Core slice 4 / C1 — AC-4 mutation (fault-injection) runner. Proves the new tests / E2E / byte-proof CAN fail.
// For each mutation: back up the target file, apply an exact single-occurrence edit, run the suites,
// ALWAYS restore the file, and verify the restored bytes by sha256. Exits non-zero if any mutation
// SURVIVES (all suites still pass) or if any file is not restored byte-identically.
//
// Usage (repo root):  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node baseline/evidence/phase2-core-slice4-mutation-script.mjs
// Needs the E2E setup from NEXUS-CONTINUATION.md §2 (symlink /home/claude/nexus-v5, playwright 1.56.1, built backend).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const F = {
  MOD: 'frontend/modules/storage.mjs',
  MAIN: 'frontend/main.js',
  HTML: 'frontend/neural_nexus_ai_agents-4-3-5-3.html',
};
const abs = (p) => path.join(ROOT, p);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const originals = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, fs.readFileSync(abs(p))]));
const originalSha = Object.fromEntries(Object.entries(originals).map(([k, b]) => [k, sha(b)]));

const SNAP_LOOP = 'for(const key in registry) snap[key] = registry[key].get();';
const RESTORE_SET = 'entry.set(decrypted && decrypted[key] !== undefined ? decrypted[key] : entry.default());';
const RESET_LOOP = 'for(const key in registry) registry[key].set(registry[key].default());';
const WRAP_SNAP = 'function snapshotPersistableState(){ return PersistableStateCore.snapshotPersistableState(PERSISTABLE_STATE); }';
const WRAP_RESTORE = 'function restorePersistableState(decrypted){ PersistableStateCore.restorePersistableState(PERSISTABLE_STATE, decrypted); }';
const WRAP_RESET = 'function resetPersistableState(){ PersistableStateCore.resetPersistableState(PERSISTABLE_STATE); }';
const BRIDGE = 'window.PersistableStateCore = { snapshotPersistableState, restorePersistableState, resetPersistableState };';

// edits: [[file, find, replace], ...]; each `find` must occur exactly once in its file
const UNIT = [
  ['U1 restore caches ONE shared default per key', [[F.MOD, 'export function restorePersistableState(registry, decrypted){', 'const __cache = {};\nexport function restorePersistableState(registry, decrypted){'], [F.MOD, ': entry.default());', ': (__cache[key] ??= entry.default()));']]],
  ['U2 restore uses truthiness instead of !== undefined', [[F.MOD, 'decrypted && decrypted[key] !== undefined ? decrypted[key]', 'decrypted && decrypted[key] ? decrypted[key]']]],
  ['U3 snapshot returns an array instead of an object', [[F.MOD, '  return snap;', '  return Object.values(snap);']]],
  ['U4 restore skips missing keys (keeps stale value)', [[F.MOD, RESTORE_SET, 'if(decrypted && decrypted[key] !== undefined) entry.set(decrypted[key]);']]],
  ['U5 reset stops after the first key', [[F.MOD, RESET_LOOP, 'for(const key in registry){ registry[key].set(registry[key].default()); break; }']]],
  ['U6 snapshot iterates keys in reverse order', [[F.MOD, SNAP_LOOP, 'for(const key of Object.keys(registry).reverse()) snap[key] = registry[key].get();']]],
  ['U7 restore writes defaults back into the decrypted input', [[F.MOD, RESTORE_SET, "if(decrypted && typeof decrypted === 'object' && decrypted[key] === undefined) decrypted[key] = entry.default(); " + RESTORE_SET]]],
  ['U8 restore calls default() eagerly for every key', [[F.MOD, RESTORE_SET, 'const d = entry.default(); entry.set(decrypted && decrypted[key] !== undefined ? decrypted[key] : d);']]],
  ['U9 snapshot deep-copies values (unrequested "improvement")', [[F.MOD, 'snap[key] = registry[key].get();', 'snap[key] = JSON.parse(JSON.stringify(registry[key].get()));']]],
  ['U10 reset reuses ONE shared default per key', [[F.MOD, 'export function resetPersistableState(registry){', 'const __rc = {};\nexport function resetPersistableState(registry){'], [F.MOD, RESET_LOOP, 'for(const key in registry) registry[key].set((__rc[key] ??= registry[key].default()));']]],
];
const E2E = [
  ['E1 bridge assignment removed from main.js', [[F.MAIN, BRIDGE, '']]],
  ['E2 restore wrapper passes an empty registry', [[F.HTML, 'PersistableStateCore.restorePersistableState(PERSISTABLE_STATE, decrypted)', 'PersistableStateCore.restorePersistableState({}, decrypted)']]],
  ['E3 snapshot wrapper drops its return value', [[F.HTML, WRAP_SNAP, WRAP_SNAP.replace('{ return ', '{ ')]]],
  ['E4 bridge swaps restore and reset', [[F.MAIN, BRIDGE, 'window.PersistableStateCore = { snapshotPersistableState, restorePersistableState: resetPersistableState, resetPersistableState: restorePersistableState };']]],
  ['E5 reset wrapper passes an empty registry', [[F.HTML, 'PersistableStateCore.resetPersistableState(PERSISTABLE_STATE)', 'PersistableStateCore.resetPersistableState({})']]],
  ['E6 snapshot wrapper silently omits `workflows` (data-loss class)', [[F.HTML, 'PersistableStateCore.snapshotPersistableState(PERSISTABLE_STATE)', "PersistableStateCore.snapshotPersistableState(Object.fromEntries(Object.entries(PERSISTABLE_STATE).filter(([k]) => k !== 'workflows')))"]]],
];

function restoreAll() {
  for (const [k, p] of Object.entries(F)) fs.writeFileSync(abs(p), originals[k]);
}
process.on('exit', restoreAll);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { restoreAll(); process.exit(130); });

function applyEdits(edits) {
  const cache = {};
  for (const [file, find, repl] of edits) {
    const cur = cache[file] ?? fs.readFileSync(abs(file), 'utf8');
    const n = cur.split(find).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must occur exactly once in ${file} (found ${n}): ${find.slice(0, 80)}`);
    cache[file] = cur.replace(find, () => repl);
  }
  for (const [file, text] of Object.entries(cache)) fs.writeFileSync(abs(file), text);
}
const run = (cmd, args, cwd, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout: 280000 });

function unitSuite() {
  const r = run('npx', ['vitest', 'run', 'modules/persistable-state.test.mjs', '--reporter=json'], abs('frontend'));
  try {
    const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    const failedNames = j.testResults.flatMap((t) => t.assertionResults.filter((a) => a.status === 'failed').map((a) => a.title));
    return { total: j.numTotalTests, failed: j.numFailedTests, sample: failedNames.slice(0, 3) };
  } catch (e) { return { total: 0, failed: -1, error: 'unparsable vitest output (counts as detection, a crash is not evidence): ' + String(r.stderr).slice(0, 120) }; }
}
function e2eSuite(script) {
  const r = run('node', [abs(`e2e/${script}`)], abs('e2e'), { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' });
  const m = r.stdout.match(/(\d+)\/(\d+) checks passed/);
  const f = (r.stdout.match(/^FAILED: (.*)$/m) || [])[1] || '';
  return { exit: r.status, passed: m ? +m[1] : null, total: m ? +m[2] : null, failed: f };
}

const results = [];
let survivors = 0;
// the proof compares against HEAD; before the commit HEAD is the base, after the commit it is the patch itself,
// so the proof detection column is only meaningful (and only asserted) when run against the base ref.
const PROOF_REF = process.env.PROOF_BASE_REF;
for (const [name, edits] of UNIT) {
  restoreAll();
  applyEdits(edits);
  const unit = unitSuite();
  const proof = PROOF_REF ? (() => { const r = run('node', [abs('baseline/evidence/phase2-core-slice4-extract-script.mjs'), 'verify', PROOF_REF], ROOT, { NO_WRITE: '1' }); return { exit: r.status, failedChecks: (r.stdout.match(/^\[FAIL\] (P\w+)/gm) || []).map((l) => l.replace('[FAIL] ', '')) }; })() : null;
  restoreAll();
  const killed = unit.failed !== 0;
  if (!killed) survivors++;
  results.push({ id: name, kind: 'unit', killedByUnit: killed, unit, byteProofDetects: proof ? proof.exit !== 0 : 'n/a', byteProofFailedChecks: proof ? proof.failedChecks : 'n/a' });
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${name} | unit failed=${unit.failed}/${unit.total} e.g. ${JSON.stringify(unit.sample || unit.error)} | byte-proof ${proof ? (proof.exit !== 0 ? 'FAILS (' + proof.failedChecks.join(',') + ')' : 'passes') : 'n/a'}`);
}
for (const [name, edits] of E2E) {
  restoreAll();
  applyEdits(edits);
  const slice4 = e2eSuite('phase2-core-slice4-flows.mjs');
  const seed = e2eSuite('phase2-core-seed-flows.mjs');
  restoreAll();
  const killed = slice4.exit !== 0;
  if (!killed) survivors++;
  results.push({ id: name, kind: 'e2e', killedBySlice4E2E: killed, slice4, preExistingCoreSeedE2EAlsoFails: seed.exit !== 0, seed });
  console.log(`${killed ? 'KILLED  ' : 'SURVIVED'} ${name} | slice4 E2E ${slice4.passed}/${slice4.total} (failed: ${slice4.failed.slice(0, 160)}) | pre-existing core-seed E2E ${seed.passed}/${seed.total}`);
}
restoreAll();
const restoredOk = Object.entries(F).every(([k, p]) => sha(fs.readFileSync(abs(p))) === originalSha[k]);
console.log('\nfiles restored byte-identically (sha256 vs before the run):', restoredOk, JSON.stringify(Object.fromEntries(Object.entries(originalSha).map(([k, v]) => [k, v.slice(0, 16)]))));
console.log(`mutations: ${UNIT.length} unit + ${E2E.length} e2e; survivors: ${survivors}`);
if (!process.env.NO_WRITE) fs.writeFileSync(abs('baseline/evidence/phase2-core-slice4-mutation-results.json'), JSON.stringify({ survivors, restoredOk, originalSha, results }, null, 2) + '\n');
process.exit(survivors || !restoredOk ? 1 : 0);
