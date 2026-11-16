/* ==========================================================================
   baseline/evidence/phase2-core-slice8-mutation-script.mjs — core slice 8 (AC-12: the acceptance test CAN fail)
   Works ONLY on scratch copies of the PATCHED frontend/ (NEXUS_S8_TMP, default os.tmpdir()); production files are never
   edited (per-file sha256 asserted before/after). BOUND TO THE PATCHED TREE (the F3 block must be present exactly once).
   Mutants (each anchor must match exactly once, else abort):
     CTRL unmodified copy                                   => ACCEPTED
     K1   revert to the original (pre-fix) lock/try layout    => REJECTED (PS offline + AC-8 red)
     K2   offline fix only (F1), no try move                  => REJECTED (AC-8 red)
     K3   re-entrancy guard condition `isSendingMessage ||` removed => REJECTED (AC-7′ red)
     K4   lock taken AFTER `await ImageStore.save`            => REJECTED (AC-7′ b red)
     K5   reset removed from the `finally`                    => INVALID (controls red)
     K6   offline check disabled (`if(false)`)                => INVALID (the offline text is really sent, so the VALID precondition
                                                                  "input still holds the text after reconnect" fails; PRES toast/nothing-sent + PS red too).
                                                                  First prediction was REJECTED — wrong; measured INVALID (CP-15 §honesty log). Either way: not ACCEPTED.
   Usage (E2E setup of NEXUS-CONTINUATION §2):  NEXUS_S8_TMP=<scratch> node baseline/evidence/phase2-core-slice8-mutation-script.mjs
   Output: baseline/evidence/phase2-core-slice8-mutation-results.json (NEXUS_S8_MUT_RESULTS overrides)
   ========================================================================== */
import { cp, readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FRONTEND = path.join(ROOT, 'frontend');
const E2E_SCRIPT = path.join(ROOT, 'e2e', 'phase2-core-slice8-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.NEXUS_S8_MUT_RESULTS || path.join(HERE, 'phase2-core-slice8-mutation-results.json');
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
  if (n !== 1) throw new Error(`anchor ${label} matched ${n} times (expected exactly 1) — this script is bound to the PATCHED tree`);
  return src.replace(from, () => to);
}

// ---- the patched block (production text) and its pre-fix counterpart ----
const PATCHED_HEAD =
"  isSendingMessage = true;\n" +
"  // BUGFIX (core slice 8): the try now starts right after the lock, so the existing catch/finally release it\n" +
"  // (and the send button) on EVERY exit — the offline early return and any failure in the preparation code\n" +
"  // (ImageStore.save, mode resolution, startTask, a missing DOM element) used to leave it set until reload.\n" +
"  let taskOutcome = 'ok'; // before the try: catch and finally use it\n" +
"  try{\n\n" +
"  if(!navigator.onLine){\n";
const ORIG_HEAD = "  isSendingMessage = true;\n\n  if(!navigator.onLine){\n";
const PATCHED_TASK = "\n\n  if(imageForThisMessage && (";
const ORIG_TASK = "\n  let taskOutcome = 'ok';\n\n  if(imageForThisMessage && (";
const PATCHED_TRY = "  }\n\n    if(selectedWorkflowId){";
const ORIG_TRY = "  }\n\n  try{\n    if(selectedWorkflowId){";
const OFFLINE_END_THEN_IMG = "    return;\n  }\n\n  const imageForThisMessage = pendingImageBase64;";
const revert = (s) => replaceOnce(replaceOnce(replaceOnce(s, PATCHED_HEAD, ORIG_HEAD, 'revert-head'), PATCHED_TASK, ORIG_TASK, 'revert-taskOutcome'), PATCHED_TRY, ORIG_TRY, 'revert-try');
const F1_ON_ORIGINAL = (s) => replaceOnce(replaceOnce(revert(s), ORIG_HEAD, "  if(!navigator.onLine){\n", 'F1a'), OFFLINE_END_THEN_IMG, "    return;\n  }\n  isSendingMessage = true;\n\n  const imageForThisMessage = pendingImageBase64;", 'F1b');

const MUTANTS = [
  { id: 'CTRL', desc: 'unmodified copy of the patched tree', apply: (s) => s, expect: 'ACCEPTED' },
  { id: 'K1', desc: 'revert to the pre-fix layout', apply: revert, expect: 'REJECTED' },
  { id: 'K2', desc: 'offline fix only (F1), no try move', apply: F1_ON_ORIGINAL, expect: 'REJECTED' },
  { id: 'K3', desc: 're-entrancy guard condition removed', apply: (s) => replaceOnce(s, "  if(isSendingMessage || sendBtn.disabled) return;", "  if(sendBtn.disabled) return;", 'K3'), expect: 'REJECTED' },
  { id: 'K4', desc: 'lock taken after the await ImageStore.save', apply: (s) => replaceOnce(replaceOnce(s, PATCHED_HEAD, PATCHED_HEAD.replace("  isSendingMessage = true;\n", ''), 'K4a'),
      "  const imageRef = imageForThisMessage ? await ImageStore.save(imageForThisMessage) : null;\n", "  const imageRef = imageForThisMessage ? await ImageStore.save(imageForThisMessage) : null;\n  isSendingMessage = true;\n", 'K4b'), expect: 'REJECTED' },
  { id: 'K5', desc: 'reset removed from the finally', apply: (s) => replaceOnce(s, "    isSendingMessage = false;\n    const finishedTask", "    const finishedTask", 'K5'), expect: 'INVALID' },
  { id: 'K6', desc: 'offline check disabled', apply: (s) => replaceOnce(s, "  if(!navigator.onLine){\n    showToast('🔌", "  if(false){\n    showToast('🔌", 'K6'), expect: 'INVALID' },
];

function runE2E(frontendDir, resultsFile) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [E2E_SCRIPT], { cwd: path.dirname(E2E_SCRIPT), env: { ...process.env, NEXUS_FRONTEND_DIR: frontendDir, NEXUS_S8_RESULTS: resultsFile }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const before = await treeHash(FRONTEND);
console.log(`production frontend tree sha256 BEFORE: ${before}`);
const workRoot = await mkdtemp(path.join(TMP_BASE, 's8-mut-'));
const results = []; let allOk = true;
try {
  const only = process.env.NEXUS_S8_ONLY ? process.env.NEXUS_S8_ONLY.split(',') : null; // debugging aid: run a subset (the committed evidence is the full run)
  for (const m of MUTANTS.filter((x) => !only || only.includes(x.id))) {
    const dir = path.join(workRoot, m.id);
    await cp(FRONTEND, dir, { recursive: true, filter: (src) => !src.split(path.sep).includes('node_modules') && !src.split(path.sep).includes('coverage') });
    const htmlPath = path.join(dir, HTML);
    const orig = await readFile(htmlPath, 'utf8');
    const mutated = m.apply(orig);
    if (m.id !== 'CTRL' && mutated === orig) throw new Error(`${m.id}: mutation changed nothing`);
    await writeFile(htmlPath, mutated);
    const { code, out } = await runE2E(dir, path.join(workRoot, m.id + '-results.json'));
    const verdict = (out.match(/S8-VERDICT = (\S+)/) || [])[1] || 'NONE';
    const counts = (out.match(/\(VALID (\S+), PRES (\S+), PS (\S+)\)/) || []).slice(1, 4);
    const failedChecks = out.split('\n').filter((l) => l.startsWith('[FAIL]')).map((l) => l.replace(/ — .*/, '').slice(0, 130));
    const ok = verdict === m.expect;
    allOk = allOk && ok;
    results.push({ id: m.id, desc: m.desc, expected: m.expect, verdict, exit: code, valid: counts[0], pres: counts[1], ps: counts[2], failedChecks: failedChecks.slice(0, 40), failedCount: failedChecks.length, caughtAsExpected: ok });
    console.log(`${ok ? 'OK ' : 'BAD'} ${m.id} (${m.desc}): verdict=${verdict} expected=${m.expect} VALID ${counts[0]} PRES ${counts[1]} PS ${counts[2]}${failedChecks.length ? '\n     failed ' + failedChecks.length + ': ' + failedChecks.slice(0, 3).join(' | ') : ''}`);
  }
} finally { await rm(workRoot, { recursive: true, force: true }); }
const after = await treeHash(FRONTEND);
console.log(`production frontend tree sha256 AFTER:  ${after}  (${before === after ? 'IDENTICAL' : 'CHANGED!'})`);
await writeFile(OUT, JSON.stringify({ productionTreeSha256Before: before, productionTreeSha256After: after, unchanged: before === after, results }, null, 2) + '\n');
console.log(`\n=== SUMMARY ===\n${results.filter((r) => r.caughtAsExpected).length}/${results.length} scenarios behaved as expected; production tree ${before === after ? 'unchanged' : 'CHANGED'}`);
process.exitCode = allOk && before === after ? 0 : 1;
