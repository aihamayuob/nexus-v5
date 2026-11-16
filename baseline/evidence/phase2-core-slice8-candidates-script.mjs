/* ==========================================================================
   baseline/evidence/phase2-core-slice8-candidates-script.mjs — core slice 8 (selection evidence)
   Evaluates the candidate fixes F1/F2/F3 of acceptance criteria (phase2-core-slice8-acceptance-criteria.md)
   on SCRATCH copies of frontend/ with e2e/phase2-core-slice8-flows.mjs. Production files are never edited
   (per-file sha256 asserted before/after). BOUND TO THE PRE-FIX TREE (`389813f`): on a patched tree the anchors
   no longer exist and the script aborts with a clear message.
   Candidates (each anchor must match exactly once):
     F1  set the lock after the offline check (slice 7 candidate A)
     F2  F1 + move `try{` up to just after the lock + hoist `let taskOutcome`
     F3  lock where it is; `try{` moved up to just after it; hoist `let taskOutcome`; no statement reordered
   F3's text is byte-for-byte the text applied to production (comment included).
   Usage (E2E setup of NEXUS-CONTINUATION §2):  NEXUS_S8_TMP=<scratch> node baseline/evidence/phase2-core-slice8-candidates-script.mjs
   Output: baseline/evidence/phase2-core-slice8-candidates-results.json (NEXUS_S8_CAND_RESULTS overrides)
   ========================================================================== */
import { cp, readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FRONTEND = path.join(ROOT, 'frontend');
const E2E_SCRIPT = path.join(ROOT, 'e2e', 'phase2-core-slice8-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.NEXUS_S8_CAND_RESULTS || path.join(HERE, 'phase2-core-slice8-candidates-results.json');
const TMP_BASE = process.env.NEXUS_S8_TMP || os.tmpdir();

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
  if (n !== 1) throw new Error(`anchor ${label} matched ${n} times (expected exactly 1) — this script is bound to the pre-fix tree 389813f`);
  return src.replace(from, () => to);
}

// ---- anchors in the PRE-FIX monolith ----
const LOCK_AND_OFFLINE = "  isSendingMessage = true;\n\n  if(!navigator.onLine){\n";
const OFFLINE_END_THEN_IMG = "    return;\n  }\n\n  const imageForThisMessage = pendingImageBase64;";
const TASKOUTCOME = "\n  let taskOutcome = 'ok';\n\n  if(imageForThisMessage && (";
const OLD_TRY = "  }\n\n  try{\n    if(selectedWorkflowId){";

export const F3_HEAD =
"  isSendingMessage = true;\n" +
"  // BUGFIX (core slice 8): the try now starts right after the lock, so the existing catch/finally release it\n" +
"  // (and the send button) on EVERY exit — the offline early return and any failure in the preparation code\n" +
"  // (ImageStore.save, mode resolution, startTask, a missing DOM element) used to leave it set until reload.\n" +
"  let taskOutcome = 'ok'; // before the try: catch and finally use it\n" +
"  try{\n\n" +
"  if(!navigator.onLine){\n";
const F3 = (s) => replaceOnce(replaceOnce(replaceOnce(s, LOCK_AND_OFFLINE, F3_HEAD, 'F3-head'), TASKOUTCOME, "\n\n  if(imageForThisMessage && (", 'F3-taskOutcome'), OLD_TRY, "  }\n\n    if(selectedWorkflowId){", 'F3-oldTry');
const F1 = (s) => replaceOnce(replaceOnce(s, LOCK_AND_OFFLINE, "  if(!navigator.onLine){\n", 'F1a'), OFFLINE_END_THEN_IMG, "    return;\n  }\n  isSendingMessage = true;\n\n  const imageForThisMessage = pendingImageBase64;", 'F1b');
const F2 = (s) => replaceOnce(replaceOnce(replaceOnce(replaceOnce(s, LOCK_AND_OFFLINE, "  if(!navigator.onLine){\n", 'F2a'),
  OFFLINE_END_THEN_IMG, "    return;\n  }\n  isSendingMessage = true;\n  let taskOutcome = 'ok';\n  try{\n\n  const imageForThisMessage = pendingImageBase64;", 'F2b'),
  TASKOUTCOME, "\n\n  if(imageForThisMessage && (", 'F2c'), OLD_TRY, "  }\n\n    if(selectedWorkflowId){", 'F2d');

const CANDIDATES = [
  { id: 'CTRL', desc: 'unmodified copy (must reproduce the PRE verdict)', apply: (s) => s, expectVerdict: 'REJECTED' },
  { id: 'F1', desc: 'set the lock after the offline check', apply: F1, expectVerdict: 'REJECTED' },
  { id: 'F2', desc: 'F1 + try moved up + taskOutcome hoisted', apply: F2, expectVerdict: 'ACCEPTED' },
  { id: 'F3', desc: 'try moved up right after the lock + taskOutcome hoisted (no reordering)', apply: F3, expectVerdict: 'ACCEPTED' },
];

function runE2E(frontendDir, resultsFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [E2E_SCRIPT], { cwd: path.dirname(E2E_SCRIPT), env: { ...process.env, NEXUS_FRONTEND_DIR: frontendDir, NEXUS_S8_RESULTS: resultsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}
const diffStat = (a, b) => {
  const r = spawnSync('diff', ['-u', a, b], { encoding: 'utf8' });
  const lines = (r.stdout || '').split('\n');
  return { added: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, removed: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length };
};

// Preflight (added in core slice 8): this script is BOUND TO THE PRE-FIX TREE (389813f). The fix of core slice 8 changed the text it anchors on.
if ((await readFile(path.join(FRONTEND, HTML), 'utf8')).includes('BUGFIX (core slice 8)')) {
  console.error('This slice 8 candidates script is bound to the pre-fix tree (389813f); the frontend already contains the core slice 8 fix. Use `git checkout 389813f` for it, or phase2-core-slice8-mutation-script.mjs for the patched tree.');
  process.exit(2);
}
const before = await treeHash(FRONTEND);
console.log(`production frontend tree sha256 BEFORE: ${before}`);
const workRoot = await mkdtemp(path.join(TMP_BASE, 's8-cand-'));
const results = []; let allOk = true;
try {
  for (const c of CANDIDATES) {
    const dir = path.join(workRoot, c.id);
    await cp(FRONTEND, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') && !src.split(path.sep).includes('coverage') });
    const htmlPath = path.join(dir, HTML);
    const orig = await readFile(htmlPath, 'utf8');
    await writeFile(htmlPath, c.apply(orig));
    const { code, out } = await runE2E(dir, path.join(workRoot, c.id + '-results.json'));
    const verdict = (out.match(/S8-VERDICT = (\S+)/) || [])[1] || 'NONE';
    const counts = (out.match(/\(VALID (\S+), PRES (\S+), PS (\S+)\)/) || []).slice(1, 4);
    const failedChecks = out.split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.replace(/ — .*/, '').slice(0, 130));
    const stat = diffStat(path.join(FRONTEND, HTML), htmlPath);
    const ok = verdict === c.expectVerdict;
    allOk = allOk && ok;
    results.push({ id: c.id, desc: c.desc, verdict, exit: code, valid: counts[0], pres: counts[1], ps: counts[2], diff: stat, failedChecks, matchedExpectation: ok });
    console.log(`${ok ? 'OK ' : 'BAD'} ${c.id} (${c.desc}): verdict=${verdict} VALID ${counts[0]} PRES ${counts[1]} PS ${counts[2]} diff=+${stat.added}/-${stat.removed}${failedChecks.length ? '\n     failed: ' + failedChecks.length + ' e.g. ' + failedChecks.slice(0, 2).join(' | ') : ''}`);
  }
} finally { await rm(workRoot, { recursive: true, force: true }); }
const after = await treeHash(FRONTEND);
console.log(`production frontend tree sha256 AFTER:  ${after}  (${before === after ? 'IDENTICAL' : 'CHANGED!'})`);
await writeFile(OUT, JSON.stringify({ productionTreeSha256Before: before, productionTreeSha256After: after, unchanged: before === after, results }, null, 2) + '\n');
console.log(`\n=== SUMMARY ===\n${results.filter((r) => r.matchedExpectation).length}/${results.length} candidates behaved as predicted; production tree ${before === after ? 'unchanged' : 'CHANGED'}`);
process.exitCode = allOk && before === after ? 0 : 1;
