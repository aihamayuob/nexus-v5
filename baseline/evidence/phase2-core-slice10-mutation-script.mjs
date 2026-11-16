/* ==========================================================================
   baseline/evidence/phase2-core-slice10-mutation-script.mjs
   Core slice 10 — proves e2e/phase2-core-slice10-flows.mjs (+ state.test.mjs) CAN DISCRIMINATE on the PATCHED tree.
   Works ONLY on scratch copies of frontend/ (os.tmpdir(), deleted afterwards); production files are never edited and their
   sha256 is checked before and after. Verdicts were PRE-REGISTERED in phase2-core-slice10-acceptance-criteria.md (AC-9) before
   any run; the registered expectation is printed next to the observed one. Run:  node <this file>
     M1 setter no-op                        expect KILLED
     M2 getter returns a fresh [] each call expect KILLED
     M3 install call removed from main.js   expect KILLED
     M4 install call moved AFTER startup    expect SURVIVES at runtime (only the static order check can catch it)
     M5 `let agentOrder = []` re-added (shadow) expect KILLED
     M6 enumerable:true                     expect KILLED
     M7 wrong initial value ['x']           expect KILLED
     M8 configurable:false                  expect KILLED
   "KILLED" = the slice 10 E2E verdict is not ACCEPTED (any check fails). Vitest is also run per mutant (reported, not used for the verdict).
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
const E2E = path.join(REPO, 'e2e', 'phase2-core-slice10-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.NEXUS_S10_MUT_RESULTS || path.join(HERE, 'phase2-core-slice10-mutation-results.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
function treeHash(dir) {
  const h = createHash('sha256');
  (function walk(d) {
    for (const n of readdirSync(d).sort()) {
      if (n === 'node_modules' || n === 'coverage') continue;
      const p = path.join(d, n);
      if (statSync(p).isDirectory()) walk(p); else { h.update(path.relative(dir, p)); h.update(readFileSync(p)); }
    }
  })(dir);
  return h.digest('hex');
}
function rep(text, from, to, label) {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: anchor found ${n} times (need exactly 1)`);
  return text.replace(from, () => to);
}

const POINTER = '/* agentOrder: owned by modules/state.mjs (slice 10, ADR-005); bare name served by the window accessor installed in main.js */\n';
const INSTALL_BLOCK = "\n// Core slice 10 (CP-18, ADR-005): `agentOrder` is owned by modules/state.mjs; this installs window.agentOrder (accessor)\n// so the classic script's bare-name reads/writes keep working. Must stay BEFORE the startup calls below.\ninstallGlobalStateAccessors(window);\n";
const TAIL = 'bootInit.finally(() => window.updateOnlineStatus());';

const MUTANTS = [
  ['M1', 'setter no-op', 'KILLED', { state: (t) => rep(t, 'set(v) { agentOrder = v; }', 'set(v) { /* MUTANT */ }', 'M1') }],
  ['M2', 'getter returns a fresh [] each call', 'KILLED', { state: (t) => rep(t, 'get() { return agentOrder; }', 'get() { return []; }', 'M2') }],
  ['M3', 'install call removed from main.js', 'KILLED', { main: (t) => rep(t, INSTALL_BLOCK, '\n', 'M3') }],
  ['M4', 'install call moved after the startup calls', 'SURVIVES', { main: (t) => rep(rep(t, INSTALL_BLOCK, '\n', 'M4a'), TAIL, TAIL + '\ninstallGlobalStateAccessors(window);', 'M4b') }],
  ['M5', 'classic `let agentOrder = []` re-added (silent shadow)', 'KILLED', { html: (t) => rep(t, POINTER, 'let agentOrder = []; // array of agent ids in user-preferred display order\n', 'M5') }],
  ['M6', 'enumerable:true', 'KILLED', { state: (t) => rep(t, 'enumerable: false', 'enumerable: true', 'M6') }],
  ['M7', "wrong initial value ['x']", 'KILLED', { state: (t) => rep(t, 'let agentOrder = [];', "let agentOrder = ['x'];", 'M7') }],
  ['M8', 'configurable:false', 'KILLED', { state: (t) => rep(t, 'configurable: true', 'configurable: false', 'M8') }],
];

const before = treeHash(FRONTEND);
const results = [];
let tmpRoot = mkdtempSync(path.join(process.env.NEXUS_S10_TMP || os.tmpdir(), 's10mut-'));
try {
  // control: unmutated copy must be ACCEPTED (else the harness, not the mutant, is at fault)
  const variants = [['CTRL', 'unmutated copy of the patched tree', 'ACCEPTED', {}], ...MUTANTS];
  for (const [id, label, expected, edits] of variants) {
    const root = path.join(tmpRoot, id); const copy = path.join(root, 'frontend');
    cpSync(FRONTEND, copy, { recursive: true, filter: (s) => !s.includes('node_modules') && !s.includes(`${path.sep}coverage`) });
    if (edits.state) { const p = path.join(copy, 'modules/state.mjs'); writeFileSync(p, edits.state(readFileSync(p, 'utf8'))); }
    if (edits.main) { const p = path.join(copy, 'main.js'); writeFileSync(p, edits.main(readFileSync(p, 'utf8'))); }
    if (edits.html) { const p = path.join(copy, HTML); writeFileSync(p, edits.html(readFileSync(p, 'utf8'))); }
    const resultsFile = path.join(root, 'res.json');
    const r = spawnSync('node', [E2E], { env: { ...process.env, NEXUS_FRONTEND_DIR: copy, NEXUS_S10_RESULTS: resultsFile }, encoding: 'utf8', timeout: 280000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const verdict = (out.match(/S10-VERDICT = ([A-Z-]+)/) || [])[1] || 'NO-VERDICT';
    let failed = [], counts = null;
    try { const j = JSON.parse(readFileSync(resultsFile, 'utf8')); failed = j.failed; counts = j.counts; } catch { /* keep empty */ }
    // vitest on the mutant copy (state.test.mjs), reported only
    let vit = null;
    if (id !== 'CTRL') {
      const v = spawnSync('npx', ['vitest', 'run', 'modules/state.test.mjs'], { cwd: FRONTEND, encoding: 'utf8', timeout: 120000, env: { ...process.env } });
      void v; // vitest is pointed at the real tree by cwd; per-mutant unit run is done below via a local copy
    }
    const observed = id === 'CTRL' ? verdict : (verdict === 'ACCEPTED' ? 'SURVIVES' : 'KILLED');
    const match = observed === expected;
    results.push({ id, label, expected, observed, e2eVerdict: verdict, counts, failed: failed.map((x) => x.slice(0, 120)), matchesPreRegistered: match });
    console.log(`${match ? '[AS-EXPECTED]' : '[DIFFERS]'} ${id} ${label} | expected ${expected} observed ${observed} (e2e ${verdict}${counts ? ` VALID ${counts.VALID} PRES ${counts.PRES} PS ${counts.PS}` : ''})${failed.length ? ' failed: ' + failed.map((x) => x.split(' — ')[0]).join(', ').slice(0, 300) : ''}`);
  }
} finally { rmSync(tmpRoot, { recursive: true, force: true }); }

// unit-test discrimination for the three state.mjs mutants (M1, M2, M6, M7, M8 change state.mjs): run state.test.mjs against each mutated state.mjs
const unit = [];
for (const [id, label, , edits] of MUTANTS.filter((m) => m[3].state)) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 's10unit-'));
  try {
    const copy = path.join(tmp, 'frontend');
    cpSync(FRONTEND, copy, { recursive: true, filter: (s) => !s.includes(`${path.sep}coverage`) && !s.endsWith(`${path.sep}node_modules`) });
    cpSync(path.join(FRONTEND, 'node_modules'), path.join(copy, 'node_modules'), { recursive: true, dereference: false, verbatimSymlinks: true });
    const p = path.join(copy, 'modules/state.mjs'); writeFileSync(p, edits.state(readFileSync(p, 'utf8')));
    const v = spawnSync('npx', ['vitest', 'run', 'modules/state.test.mjs', '--reporter=json'], { cwd: copy, encoding: 'utf8', timeout: 120000 });
    const j = (() => { try { return JSON.parse(v.stdout.slice(v.stdout.indexOf('{'))); } catch { return null; } })();
    const row = { id, label, unitFailed: j ? j.numFailedTests : null, unitTotal: j ? j.numTotalTests : null, unitKilled: j ? j.numFailedTests > 0 : null };
    unit.push(row); console.log(`[UNIT] ${id} ${label} | state.test.mjs failed ${row.unitFailed}/${row.unitTotal} -> ${row.unitKilled ? 'KILLED' : 'SURVIVES'}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const after = treeHash(FRONTEND);
const untouched = before === after;
console.log(`${untouched ? '[PASS]' : '[FAIL]'} production frontend/ tree sha256 unchanged (${before.slice(0, 16)}… -> ${after.slice(0, 16)}…)`);
const diffs = results.filter((r) => !r.matchesPreRegistered);
writeFileSync(OUT, JSON.stringify({ slice: 'core-slice-10', productionFrontendSha256Before: before, productionFrontendSha256After: after, untouched, e2eMutants: results, unitMutants: unit }, null, 2) + '\n');
console.log(`\nMUTATION: ${results.length - diffs.length}/${results.length} as pre-registered (incl. control)${diffs.length ? '  DIFFERS: ' + diffs.map((d) => d.id).join(',') : ''}; production untouched: ${untouched}`);
process.exit(untouched && diffs.length === 0 ? 0 : 1);
