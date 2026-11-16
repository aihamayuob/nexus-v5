/* ==========================================================================
   baseline/evidence/phase2-core-slice7-mutation-script.mjs — core slice 7 (EVIDENCE ONLY)
   Proves e2e/phase2-core-slice7-flows.mjs can DISCRIMINATE. Works ONLY on scratch copies of frontend/
   (NEXUS_S7_TMP, default os.tmpdir()); production files are never edited. The script asserts that the
   production tree's per-file sha256 is identical before and after.

   Mutants (each anchor must match exactly once, else the run aborts):
     M1  candidate fix A — set isSendingMessage AFTER the offline check            => expect NOT-STUCK, validity all green, exit 0
     M2  offline check disabled (`if(false)`)                                      => expect INCONCLUSIVE (AC-4 offline-toast check fails), exit != 0
     M3  the reset in the `finally` removed                                        => expect INCONCLUSIVE (AC-1 control fails), exit != 0
     M4  candidate fix B — reset the flag inside the offline branch before return  => expect NOT-STUCK, validity all green, exit 0
   M1 and M4 are NOT applied to production: they only show the test recognises a fixed behaviour.
   Usage (needs the E2E setup of NEXUS-CONTINUATION §2):  node baseline/evidence/phase2-core-slice7-mutation-script.mjs
   Output: baseline/evidence/phase2-core-slice7-mutation-results.json (NEXUS_S7_MUT_RESULTS overrides)
   ========================================================================== */
import { cp, readFile, writeFile, readdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FRONTEND = path.join(ROOT, 'frontend');
const E2E_SCRIPT = path.join(ROOT, 'e2e', 'phase2-core-slice7-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.NEXUS_S7_MUT_RESULTS || path.join(HERE, 'phase2-core-slice7-mutation-results.json');
const TMP_BASE = process.env.NEXUS_S7_TMP || os.tmpdir();

async function walk(dir, base = dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'coverage') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, acc); else acc.push(path.relative(base, p));
  }
  return acc.sort();
}
async function treeHash(dir) {
  const h = createHash('sha256');
  for (const f of await walk(dir)) { h.update(f + '\0'); h.update(await readFile(path.join(dir, f))); h.update('\0'); }
  return h.digest('hex');
}
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`anchor for ${label} matched ${n} times (expected exactly 1)`);
  return src.replace(from, () => to);
}
const OFFLINE_OPEN = "  isSendingMessage = true;\n\n  if(!navigator.onLine){\n";
const OFFLINE_CLOSE_THEN_IMG = "    return;\n  }\n\n  const imageForThisMessage = pendingImageBase64;";
const MUTANTS = [
  { id: 'M1', desc: 'candidate fix A: flag set after the offline check', expect: { verdict: 'NOT-STUCK', exit: 0 },
    apply: (s) => replaceOnce(replaceOnce(s, OFFLINE_OPEN, "  if(!navigator.onLine){\n", 'M1a'), OFFLINE_CLOSE_THEN_IMG, "    return;\n  }\n  isSendingMessage = true;\n\n  const imageForThisMessage = pendingImageBase64;", 'M1b') },
  { id: 'M2', desc: 'offline check disabled', expect: { verdict: 'INCONCLUSIVE', exit: 1 },
    apply: (s) => replaceOnce(s, "  if(!navigator.onLine){\n    showToast('🔌", "  if(false){\n    showToast('🔌", 'M2') },
  { id: 'M3', desc: 'finally reset removed', expect: { verdict: 'INCONCLUSIVE', exit: 1 },
    apply: (s) => replaceOnce(s, "    isSendingMessage = false;\n    const finishedTask", "    const finishedTask", 'M3') },
  { id: 'M4', desc: 'candidate fix B: reset the flag in the offline branch before return', expect: { verdict: 'NOT-STUCK', exit: 0 },
    apply: (s) => replaceOnce(s, OFFLINE_CLOSE_THEN_IMG, "    isSendingMessage = false;\n    return;\n  }\n\n  const imageForThisMessage = pendingImageBase64;", 'M4') },
];

function runE2E(frontendDir, resultsFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [E2E_SCRIPT], { cwd: path.dirname(E2E_SCRIPT), env: { ...process.env, NEXUS_FRONTEND_DIR: frontendDir, NEXUS_S7_RESULTS: resultsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

// Preflight (added in core slice 8): this script is BOUND TO THE PRE-FIX TREE (389813f). The fix of core slice 8 changed the text it anchors on.
if ((await readFile(path.join(FRONTEND, HTML), 'utf8')).includes('BUGFIX (core slice 8)')) {
  console.error('This slice 7 mutation script is bound to the pre-fix tree (389813f); the frontend already contains the core slice 8 fix. Use `git checkout 389813f` for it, or phase2-core-slice8-mutation-script.mjs for the patched tree.');
  process.exit(2);
}
const before = await treeHash(FRONTEND);
console.log(`production frontend tree sha256 BEFORE: ${before}`);
const workRoot = await mkdtemp(path.join(TMP_BASE, 's7-mut-'));
const results = [];
let allOk = true;
try {
  // control: unmutated COPY must reproduce the production verdict (STUCK) — proves the copy mechanism itself is neutral
  const plan = [{ id: 'CTRL', desc: 'unmutated copy', expect: { verdict: 'STUCK', exit: 0 }, apply: (s) => s }, ...MUTANTS];
  for (const m of plan) {
    const dir = path.join(workRoot, m.id);
    await cp(FRONTEND, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') && !src.split(path.sep).includes('coverage') });
    const htmlPath = path.join(dir, HTML);
    const orig = await readFile(htmlPath, 'utf8');
    const mutated = m.apply(orig);
    if (m.id !== 'CTRL' && mutated === orig) throw new Error(`${m.id}: mutation changed nothing`);
    await writeFile(htmlPath, mutated);
    const { code, out } = await runE2E(dir, path.join(workRoot, m.id + '-results.json'));
    const verdict = (out.match(/S7-VERDICT = (\S+)/) || [])[1] || 'NONE';
    const passed = (out.match(/(\d+)\/(\d+) validity checks passed/) || []).slice(1, 3).join('/');
    const failedChecks = out.split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.slice(0, 140));
    const ok = verdict === m.expect.verdict && code === m.expect.exit;
    allOk = allOk && ok;
    results.push({ id: m.id, desc: m.desc, expected: m.expect, got: { verdict, exit: code, validity: passed, failedChecks }, caughtAsExpected: ok });
    console.log(`${ok ? 'OK ' : 'BAD'} ${m.id} (${m.desc}): verdict=${verdict} exit=${code} validity=${passed} expected=${JSON.stringify(m.expect)}${failedChecks.length ? '\n     ' + failedChecks.slice(0, 3).join('\n     ') : ''}`);
  }
} finally { await rm(workRoot, { recursive: true, force: true }); }
const after = await treeHash(FRONTEND);
const unchanged = before === after;
console.log(`production frontend tree sha256 AFTER:  ${after}  (${unchanged ? 'IDENTICAL' : 'CHANGED!'})`);
console.log(`\n=== SUMMARY ===\n${results.filter((r) => r.caughtAsExpected).length}/${results.length} scenarios behaved as expected; production tree ${unchanged ? 'unchanged' : 'CHANGED'}`);
await writeFile(OUT, JSON.stringify({ productionTreeSha256Before: before, productionTreeSha256After: after, unchanged, results }, null, 2) + '\n');
process.exitCode = allOk && unchanged ? 0 : 1;
