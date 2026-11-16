/* ==========================================================================
   baseline/evidence/phase2-evidence-integrity-mutation-script.mjs — Evidence Integrity (CP-16): the new tests CAN fail.
   Works ONLY on scratch copies (EI_TMP, default os.tmpdir()); production files are never edited (tree sha256 asserted before/after).
   BOUND TO THE PATCHED TREE: every anchor must match exactly once, else the script aborts (exit 2).

   Controls
     CTRL-POST  unmodified copy of the patched tree                                => backend 0 failing / UI ACCEPTED
     CTRL-PRE   production files of EI_BASE_REF (default b811065) + the NEW tests   => backend: many failing / UI REJECTED (proves the tests discriminate;
                                                                                       in particular AC-7 upgrade-path fails for the RIGHT reason: no migration 016)
   Mutants (expected KILLED = at least one test/check fails; W3 is an expected, documented SURVIVOR — see its note)
     B*  evaluationEngine.ts   R* routes/v2/evaluation.ts   P* claimEvaluationRepo.ts   W* webResearch.ts   G* migration 016   U* Ops Center UI
     X*  security mutants (added in the 2026-10-12 verification pass; aim at the AC-S* tests)
   Backend subset run per mutant: evidenceIntegrity, evaluationEngine, claimEvaluationRoutes, webResearch tests (CTRL-POST also runs
   productionHardening + resilience). UI mutants run e2e/phase2-evidence-integrity-flows.mjs on a scratch copy of frontend/ (NEXUS_FRONTEND_DIR).
   Usage:  EI_TMP=<scratch> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node baseline/evidence/phase2-evidence-integrity-mutation-script.mjs
   Output: baseline/evidence/phase2-evidence-integrity-mutation-results.json (EI_MUT_RESULTS overrides). Deterministic: no timings.
   ========================================================================== */
import { cp, readFile, writeFile, readdir, mkdtemp, rm, mkdir, symlink, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BACKEND = path.join(ROOT, 'src-baseline', 'nexus-backend');
const FRONTEND = path.join(ROOT, 'frontend');
const UI_SCRIPT = path.join(ROOT, 'e2e', 'phase2-evidence-integrity-flows.mjs');
const HTML = 'neural_nexus_ai_agents-4-3-5-3.html';
const OUT = process.env.EI_MUT_RESULTS || path.join(HERE, 'phase2-evidence-integrity-mutation-results.json');
const TMP_BASE = process.env.EI_TMP || os.tmpdir();
const BASE_REF = process.env.EI_BASE_REF || 'b811065';
const SUBSET = ['test/evidenceIntegrity.test.ts', 'test/evaluationEngine.test.ts', 'test/claimEvaluationRoutes.test.ts', 'test/webResearch.test.ts'];
const FULL_CTRL = [...SUBSET, 'test/productionHardening.test.ts', 'test/resilience.test.ts'];

async function walk(dir, base = dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'coverage', 'dist', 'data', '.git'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, base, acc); else acc.push(path.relative(base, p));
  }
  return acc.sort();
}
async function treeHash(...dirs) {
  const h = createHash('sha256');
  for (const d of dirs) for (const f of await walk(d)) { h.update(d + '/' + f + '\0'); h.update(await readFile(path.join(d, f))); h.update('\0'); }
  return h.digest('hex');
}
function replaceOnce(src, from, to, label) {
  const n = src.split(from).length - 1;
  if (n !== 1) { console.error(`ABORT: anchor ${label} matched ${n} times (expected exactly 1) — this script is bound to the PATCHED tree`); process.exit(2); }
  return src.replace(from, () => to);
}
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
    c.on('close', (code) => resolve({ code, out }));
  });
}

// ---------- scratch builders ----------
async function makeBackendCopy(label, { fromRef = null } = {}) {
  const dir = await mkdtemp(path.join(TMP_BASE, `ei-mut-${label}-`));
  if (fromRef) { // production source of a git ref + the CURRENT tests
    const tar = spawnSync('sh', ['-c', `git -C "${ROOT}" archive ${fromRef} src-baseline/nexus-backend/src src-baseline/nexus-backend/package.json src-baseline/nexus-backend/tsconfig.json | tar -x -C "${dir}"`]);
    if (tar.status !== 0) { console.error('git archive failed', String(tar.stderr)); process.exit(2); }
    const root = path.join(dir, 'src-baseline', 'nexus-backend');
    await cp(path.join(BACKEND, 'test'), path.join(root, 'test'), { recursive: true });
    await symlink(path.join(BACKEND, 'node_modules'), path.join(root, 'node_modules'));
    return { dir, root };
  }
  const root = path.join(dir, 'b');
  await mkdir(root, { recursive: true });
  for (const d of ['src', 'test']) await cp(path.join(BACKEND, d), path.join(root, d), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json']) await cp(path.join(BACKEND, f), path.join(root, f));
  await symlink(path.join(BACKEND, 'node_modules'), path.join(root, 'node_modules'));
  return { dir, root };
}
async function makeFrontendCopy(label, { fromRef = null } = {}) {
  const dir = await mkdtemp(path.join(TMP_BASE, `ei-mut-${label}-`));
  if (fromRef) {
    const tar = spawnSync('sh', ['-c', `git -C "${ROOT}" archive ${fromRef} frontend | tar -x -C "${dir}"`]);
    if (tar.status !== 0) { console.error('git archive failed', String(tar.stderr)); process.exit(2); }
    return { dir, root: path.join(dir, 'frontend') };
  }
  const root = path.join(dir, 'f');
  await mkdir(root, { recursive: true });
  for (const e of await readdir(FRONTEND, { withFileTypes: true })) {
    if (['node_modules', 'coverage'].includes(e.name)) continue;
    await cp(path.join(FRONTEND, e.name), path.join(root, e.name), { recursive: true });
  }
  return { dir, root };
}
async function runBackend(root, files) {
  const r = await run('tsx', ['--test', ...files], { cwd: root, env: { ...process.env, NEXUS_LOG_LEVEL: 'error' } });
  const m = (k) => { const x = r.out.match(new RegExp(`^# ${k} (\\d+)`, 'm')); return x ? Number(x[1]) : null; };
  return { tests: m('tests'), pass: m('pass'), fail: m('fail'), exit: r.code };
}
async function runUi(frontendRoot, resultsFile) {
  const r = await run('node', [UI_SCRIPT], { cwd: path.join(ROOT, 'e2e'), env: { ...process.env, NEXUS_FRONTEND_DIR: frontendRoot, NEXUS_EI_UI_RESULTS: resultsFile } });
  const v = r.out.match(/EI-UI-VERDICT = (\w+)/); const c = r.out.match(/\(VALID (\S+), PRES (\S+), PS (\S+)\)/);
  return { verdict: v ? v[1] : 'NO-VERDICT', valid: c?.[1] ?? null, pres: c?.[2] ?? null, ps: c?.[3] ?? null, exit: r.code };
}

// ---------- mutants ----------
const E = 'src/evaluation/evaluationEngine.ts', RT = 'src/routes/v2/evaluation.ts', RP = 'src/persistence/repositories/claimEvaluationRepo.ts', WR = 'src/research/webResearch.ts';
const M016 = 'src/persistence/migrations/016_claim_evaluation_integrity_reason.sql';
const backendMutants = [
  { id: 'B1', file: E, what: 'every item is a delta (fail-closed filter removed)', from: "const deltas = evidence.filter((e) => !!e && isEvidenceDeltaKind(e.kind));", to: "const deltas = evidence.filter((e) => !!e);" },
  { id: 'B2', file: E, what: 'judge receives ALL evidence, not only deltas', from: "${buildEvidenceBlock(deltas)}", to: "${buildEvidenceBlock(evidence)}" },
  { id: 'B3', file: E, what: 'contradiction guard disabled', from: "const lowered = hasContradiction && (verdict === 'VERIFIED' || verdict === 'SUPPORTED');", to: "const lowered = false;" },
  { id: 'B4', file: E, what: 'guard over-reaches: lowers every verdict except CONFLICTING', from: "const lowered = hasContradiction && (verdict === 'VERIFIED' || verdict === 'SUPPORTED');", to: "const lowered = hasContradiction && verdict !== 'CONFLICTING';" },
  { id: 'B5', file: E, what: 'any string is accepted as a valid kind', from: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value)", to: "true" },
  { id: 'B6', file: E, what: 'kind matching made case-insensitive', from: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value)", to: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value.toUpperCase())" },
  { id: 'B7', file: E, what: 'reason precedence swapped (EXECUTABLE before CONTRADICTORY)', from: "hasContradiction ? 'CONTRADICTORY_EVIDENCE' : deltas.some((e) => e.kind === 'EXECUTABLE_VERIFICATION') ? 'EXECUTABLE_VERIFICATION' : 'INDEPENDENT_EVIDENCE'", to: "deltas.some((e) => e.kind === 'EXECUTABLE_VERIFICATION') ? 'EXECUTABLE_VERIFICATION' : hasContradiction ? 'CONTRADICTORY_EVIDENCE' : 'INDEPENDENT_EVIDENCE'" },
  { id: 'B8', file: E, what: 'confidence kept on a lowered verdict', from: "confidence: lowered ? null : confidence,", to: "confidence: confidence," },
  { id: 'B9', file: E, what: 'zero-evidence reason mislabelled CONSENSUS_ONLY', from: "conflictingEvidenceCount: 0, integrityReason: 'NO_EVIDENCE' };", to: "conflictingEvidenceCount: 0, integrityReason: 'CONSENSUS_ONLY' };" },
  { id: 'B10', file: E, what: 'consensus-only shortcut disabled (judge called with an empty block)', from: "if (deltas.length === 0) {", to: "if (deltas.length === -1) {" },
  { id: 'B11', file: E, what: 'consensus-only result loses its deterministic confidence', from: "rationale: 'الأدلة المُقدَّمة لا تعلن نوع دليل صالحاً (Evidence Delta) فلا تُحتسب أدلة؛ اتفاق الأطراف أو الوكلاء وحده لا يرفع حالة الادعاء.',\n        supportingEvidenceCount: 0,", to: "rationale: 'الأدلة المُقدَّمة لا تعلن نوع دليل صالحاً (Evidence Delta) فلا تُحتسب أدلة؛ اتفاق الأطراف أو الوكلاء وحده لا يرفع حالة الادعاء.',\n        supportingEvidenceCount: 1," },
  { id: 'R1', file: RT, what: 'route keeps an invalid kind in the stored evidence', from: "return isEvidenceDeltaKind(kind) ? { ...rest, kind } : rest;", to: "return e;" },
  { id: 'R2', file: RT, what: 'route drops even a valid kind', from: "return isEvidenceDeltaKind(kind) ? { ...rest, kind } : rest;", to: "return isEvidenceDeltaKind(kind) ? rest : rest;" },
  { id: 'P1', file: RP, what: 'repo does not persist the reason (inserts NULL)', from: "createdAt,\n        result.integrityReason ?? null\n      );", to: "createdAt,\n        null\n      );" },
  { id: 'P2', file: RP, what: 'repo does not map the column back on read', from: "integrityReason: (row.integrity_reason as string | null | undefined) ?? null,", to: "integrityReason: null," },
  { id: 'P3', file: RP, what: 'save() returns a record without the reason', from: "integrityReason: result.integrityReason ?? null, createdAt };", to: "integrityReason: null, createdAt };" },
  { id: 'W1', file: WR, what: 'producer no longer declares kind TOOL_RESULT', from: "return sources.filter((s) => s.fetchOk).map((s) => ({ source: s.url, content: s.contentPreview, kind: 'TOOL_RESULT' }));", to: "return sources.filter((s) => s.fetchOk).map((s) => ({ source: s.url, content: s.contentPreview }));" },
  { id: 'W2', file: WR, what: 'producer counts failed fetches as evidence', from: "return sources.filter((s) => s.fetchOk).map((s) => ({ source: s.url, content: s.contentPreview, kind: 'TOOL_RESULT' }));", to: "return sources.map((s) => ({ source: s.url, content: s.contentPreview, kind: 'TOOL_RESULT' }));" },
  { id: 'W3', file: WR, expectSurvive: true, what: 'runWebResearch stops using buildResearchEvidence (inline, no kind)', from: "const evidence = buildResearchEvidence(sources);", to: "const evidence: EvidenceItem[] = sources.filter((s) => s.fetchOk).map((s) => ({ source: s.url, content: s.contentPreview }));",
    note: 'EXPECTED SURVIVOR: the SSRF guard makes a fetchOk:true source unreachable in the sandbox, so the wiring of the builder into runWebResearch is not observable by any test (CP-16 limits). Under fail-closed such a mutant would make web research evaluate to CONSENSUS_ONLY in production — fail-closed, i.e. safe, not silent upgrade.' },
  { id: 'G1', file: M016, remove: true, what: 'migration 016 deleted' },
  { id: 'G2', file: M016, what: 'column made NOT NULL DEFAULT \'\'', from: "ADD COLUMN integrity_reason TEXT;", to: "ADD COLUMN integrity_reason TEXT NOT NULL DEFAULT '';" },
  { id: 'G3', file: M016, what: 'migration also backfills legacy rows', from: "ADD COLUMN integrity_reason TEXT;", to: "ADD COLUMN integrity_reason TEXT;\nUPDATE claim_evaluations SET integrity_reason = 'CONSENSUS_ONLY';" },
  // ---- security mutants (verification pass 2026-10-12; each aims at the AC-S* tests added after the implementation)
  { id: 'X1', file: E, what: 'kind is trimmed before matching (whitespace-padded kinds accepted)', from: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value)", to: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value.trim())" },
  { id: 'X2', file: E, what: 'kind matched with the `in` operator on an object literal (prototype names like constructor/toString/__proto__ accepted)', from: "(EVIDENCE_DELTA_KINDS as readonly string[]).includes(value)", to: "value in ({ INDEPENDENT_SOURCE: 1, TOOL_RESULT: 1, EXECUTABLE_VERIFICATION: 1, ENVIRONMENTAL_OBSERVATION: 1, HUMAN_CONFIRMATION: 1, CONTRADICTORY_EVIDENCE: 1 } as Record<string, number>)" },
  { id: 'X3', file: E, what: 'engine also reads kind through the item\'s __proto__ (prototype smuggling)', from: "const deltas = evidence.filter((e) => !!e && isEvidenceDeltaKind(e.kind));", to: "const deltas = evidence.filter((e) => !!e && isEvidenceDeltaKind(e.kind ?? (e as unknown as { __proto__?: { kind?: unknown } }).__proto__?.kind));" },
  { id: 'X4', file: E, what: 'null guard removed from the delta filter', from: "const deltas = evidence.filter((e) => !!e && isEvidenceDeltaKind(e.kind));", to: "const deltas = evidence.filter((e) => isEvidenceDeltaKind(e.kind));" },
  { id: 'X5', file: RT, what: 'route no longer validates item shape (any truthy entry is evidence)', from: "typeof e.source === 'string' && typeof e.content === 'string'", to: "true" },
  { id: 'X6', file: RP, what: 'subject_type is interpolated into the INSERT SQL instead of bound (SQL injection)', from: "         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`\n      )\n      .run(\n        id,\n        subjectType,\n        subjectId,", to: "         VALUES (?, '${subjectType}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`\n      )\n      .run(\n        id,\n        subjectId," },
];
const uiMutants = [
  { id: 'U1', what: 'a kind is preselected (placeholder moved after the options)', from: "<option value=\"\" selected>— اختر نوع الدليل —</option>${kindOptions}", to: "${kindOptions}<option value=\"\">— اختر نوع الدليل —</option>" },
  { id: 'U2', what: 'submit block disabled', from: "if(evidence.some(e=>!e.kind)){", to: "if(false){" },
  { id: 'U3', what: 'kind is collected but not sent in the request body', from: "body:{ claim, evidence, subjectType:", to: "body:{ claim, evidence: evidence.map(e=>({source:e.source,content:e.content})), subjectType:" },
  { id: 'U4', what: 'one valid kind missing from the selector', from: "['HUMAN_CONFIRMATION','تأكيد بشري صريح'], ", to: "" },
  { id: 'U5', what: 'block only when EVERY row lacks a kind (silent partial send)', from: "if(evidence.some(e=>!e.kind)){", to: "if(evidence.every(e=>!e.kind)){" },
  { id: 'U6', what: 'reason line removed from the record render', from: "    ${c.integrityReason ? `<div class=\"log-ts\">سبب الحالة (النزاهة): ${escapeHtml(c.integrityReason)}</div>` : ''}\n", to: "" },
  { id: 'U7', what: 'reason rendered without HTML escaping', from: "${escapeHtml(c.integrityReason)}", to: "${c.integrityReason}" },
];

const results = { baseRef: BASE_REF, controls: {}, mutants: [] };
const prodBefore = await treeHash(path.join(BACKEND, 'src'), path.join(BACKEND, 'test'), FRONTEND);
const scratch = [];
let exitCode = 0;
try {
  // ---- controls
  { const { dir, root } = await makeBackendCopy('ctrlpost'); scratch.push(dir);
    const r = await runBackend(root, FULL_CTRL);
    results.controls['CTRL-POST-backend'] = { ...r, expected: 'fail=0', ok: r.fail === 0 && r.tests > 0 }; console.log('CTRL-POST backend', JSON.stringify(r)); }
  { const { dir, root } = await makeFrontendCopy('ctrlpostui'); scratch.push(dir);
    const r = await runUi(root, path.join(dir, 'ui.json'));
    results.controls['CTRL-POST-ui'] = { ...r, expected: 'ACCEPTED', ok: r.verdict === 'ACCEPTED' }; console.log('CTRL-POST ui', JSON.stringify(r)); }
  { const { dir, root } = await makeBackendCopy('ctrlpre', { fromRef: BASE_REF }); scratch.push(dir);
    const r = await runBackend(path.join(dir, 'src-baseline', 'nexus-backend'), SUBSET);
    results.controls['CTRL-PRE-backend'] = { ...r, expected: 'fail>0 incl. AC-7 upgrade path', ok: r.fail > 0 }; console.log('CTRL-PRE backend', JSON.stringify(r));
    // AC-7 upgrade-path test, alone, on the pre-patch production: must fail because 016 does not exist (the launcher works here)
    const one = await run('tsx', ['--test', '--test-name-pattern=real runner upgrades', 'test/evidenceIntegrity.test.ts'], { cwd: path.join(dir, 'src-baseline', 'nexus-backend'), env: { ...process.env, NEXUS_LOG_LEVEL: 'error' } });
    const failed = /^not ok/m.test(one.out); const rightReason = /integrity_reason|integrityReason|legacy|!==|deepEqual|strictEqual/i.test(one.out) && !/Cannot find package 'tsx'|ERR_MODULE_NOT_FOUND/.test(one.out);
    results.controls['CTRL-PRE-AC7-upgrade-path'] = { failed, rightReason, expected: 'fails for the right reason (not a launcher error)', ok: failed && rightReason }; console.log('CTRL-PRE AC-7', failed, rightReason); }
  { const { dir, root } = await makeFrontendCopy('ctrlpreui', { fromRef: BASE_REF }); scratch.push(dir);
    const r = await runUi(root, path.join(dir, 'ui.json'));
    results.controls['CTRL-PRE-ui'] = { ...r, expected: 'REJECTED (VALID+PRES green, PS red)', ok: r.verdict === 'REJECTED' }; console.log('CTRL-PRE ui', JSON.stringify(r)); }

  // ---- backend mutants
  for (const m of backendMutants) {
    const { dir, root } = await makeBackendCopy(m.id); scratch.push(dir);
    const target = path.join(root, m.file);
    if (m.remove) await unlink(target);
    else await writeFile(target, replaceOnce(await readFile(target, 'utf-8'), m.from, m.to, m.id));
    const r = await runBackend(root, SUBSET);
    const killed = r.fail > 0 || r.exit !== 0;
    const ok = m.expectSurvive ? !killed : killed;
    results.mutants.push({ id: m.id, what: m.what, kind: 'backend', failing: r.fail, tests: r.tests, killed, expected: m.expectSurvive ? 'SURVIVES (documented)' : 'KILLED', ok, ...(m.note ? { note: m.note } : {}) });
    console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} (fail=${r.fail}/${r.tests}) ${ok ? 'as expected' : '*** UNEXPECTED ***'} — ${m.what}`);
    await rm(dir, { recursive: true, force: true });
  }
  // ---- UI mutants
  for (const m of uiMutants) {
    const { dir, root } = await makeFrontendCopy(m.id); scratch.push(dir);
    const target = path.join(root, HTML);
    await writeFile(target, replaceOnce(await readFile(target, 'utf-8'), m.from, m.to, m.id));
    const r = await runUi(root, path.join(dir, 'ui.json'));
    const killed = r.verdict !== 'ACCEPTED';
    results.mutants.push({ id: m.id, what: m.what, kind: 'ui', verdict: r.verdict, valid: r.valid, pres: r.pres, ps: r.ps, killed, expected: 'KILLED', ok: killed });
    console.log(`${m.id} ${killed ? 'KILLED' : 'SURVIVED'} (${r.verdict}; VALID ${r.valid} PRES ${r.pres} PS ${r.ps}) ${killed ? 'as expected' : '*** UNEXPECTED ***'} — ${m.what}`);
    await rm(dir, { recursive: true, force: true });
  }
} finally {
  for (const d of scratch) await rm(d, { recursive: true, force: true }).catch(() => {});
}
const prodAfter = await treeHash(path.join(BACKEND, 'src'), path.join(BACKEND, 'test'), FRONTEND);
results.productionUnchanged = prodBefore === prodAfter;
const allControls = Object.values(results.controls).every((c) => c.ok);
const allMut = results.mutants.every((m) => m.ok);
results.summary = { controlsOk: allControls, mutants: results.mutants.length, asExpected: results.mutants.filter((m) => m.ok).length, killed: results.mutants.filter((m) => m.killed).length };
console.log(`\n=== SUMMARY === controls ok: ${allControls}; mutants as expected: ${results.summary.asExpected}/${results.summary.mutants} (killed ${results.summary.killed}); production sha unchanged: ${results.productionUnchanged}`);
await writeFile(OUT, JSON.stringify(results, null, 2) + '\n');
console.log('results ->', OUT);
process.exit(allControls && allMut && results.productionUnchanged ? 0 : 1);
