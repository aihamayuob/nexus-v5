// Core slice 9 — ownership PROTOTYPES for the C2 pilot variable `agentOrder`, measured on SCRATCH CLONES only.
// NOTHING here is applied to the production tree: each variant is a `git clone` of HEAD in a scratch dir, patched
// there and committed there (so the clean-tree assertions of the older evidence tools stay meaningful).
//
// Variants:
//   CTRL    unmodified clone (only the E2E FRONTEND_DIR path rewritten to the clone; probe copied in)
//   PA      explicit store:      modules/state.mjs exports NexusState {agentOrder}; classic sites -> NexusState.agentOrder
//   PB      global accessor shim: module owns the value; main.js installs Object.defineProperty(window,'agentOrder',...);
//                                the classic `let agentOrder` is removed; every bare-name site is untouched
//   MUT-PA  PA with the rebind site LEFT as a bare-name write       (probe MUST fail  -> proves the probe can fail)
//   MUT-PB  PB with a no-op setter                                  (probe MUST fail)
// Measured per variant: Vitest, 4 existing E2E suites, the slice 9 probe, slice 3 analyzer, slice 2 probe, patch size.
//
// Usage:  ACORN_DIR=<dir with node_modules/acorn> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
//         S9_TMP=<scratch> [S9_ONLY=CTRL,PA] node baseline/evidence/phase2-core-slice9-ownership-prototypes.mjs
// Needs: frontend/node_modules, e2e/node_modules (playwright 1.56.1), built backend, /home/claude/nexus-v5 -> repo (E2E hard-coded BACKEND_DIR).
// Aborts with exit 2 if an anchor does not match exactly once. Writes S9_RESULTS (default: ...-prototypes-results.json next to this file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const TMP = process.env.S9_TMP || fs.mkdtempSync(path.join(os.tmpdir(), 's9-'));
const OUT = process.env.S9_RESULTS || path.join(here, 'phase2-core-slice9-ownership-prototypes-results.json');
if (!process.env.ACORN_DIR) { console.error('ACORN_DIR is required'); process.exit(2); }
const ONLY = (process.env.S9_ONLY || 'CTRL,PA,PB,MUT-PA,MUT-PB,PB-C3').split(',');
const HTML = 'frontend/neural_nexus_ai_agents-4-3-5-3.html';
const SUITES = ['baseline-flows', 'phase1-security-flows', 'phase2-core-seed-flows', 'phase2-core-slice4-flows'];
const sh = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=s9@scratch', '-c', 'user.name=s9', ...a], { cwd, encoding: 'utf8' });

function once(src, needle, label) {
  const n = src.split(needle).length - 1;
  if (n !== 1) { console.error(`ANCHOR ${label}: expected exactly 1 match, found ${n}`); process.exit(2); }
}
function rep(src, needle, repl, label) { once(src, needle, label); return src.replace(needle, () => repl); }

const A1 = 'let agentOrder = []; // array of agent ids in user-preferred display order\n';
const A2 = "  const ordered = agentOrder.map(id => all.find(a => a.id === id)).filter(Boolean);\n  const remaining = all.filter(a => !agentOrder.includes(a.id));";
const A3 = '  agentOrder = ordered; // now fully explicit — locks in the whole order';
const A4 = '  agentOrder:      { get:()=>agentOrder,      set:v=>agentOrder=v,      default:()=>[] },';
const M1 = "from './modules/settings.mjs';\n";
const M2 = 'window.saveLocalModelSetting = saveLocalModelSetting;\n';

function patch(variant, repo) {
  const hp = path.join(repo, HTML), mp = path.join(repo, 'frontend/main.js');
  let h = fs.readFileSync(hp, 'utf8'), m = fs.readFileSync(mp, 'utf8');
  const A = variant === 'PA' || variant === 'MUT-PA';
  const B = variant === 'PB' || variant === 'MUT-PB';
  if (A) {
    h = rep(h, A1, '/* agentOrder: owned by modules/state.mjs (PROTOTYPE PA) */\n', 'A1');
    h = rep(h, A2, "  const ordered = NexusState.agentOrder.map(id => all.find(a => a.id === id)).filter(Boolean);\n  const remaining = all.filter(a => !NexusState.agentOrder.includes(a.id));", 'A2');
    if (variant === 'PA') h = rep(h, A3, '  NexusState.agentOrder = ordered; // now fully explicit — locks in the whole order', 'A3');
    else once(h, A3, 'A3(mut: left as bare write)');
    h = rep(h, A4, '  agentOrder:      { get:()=>NexusState.agentOrder, set:v=>NexusState.agentOrder=v, default:()=>[] },', 'A4');
    m = rep(m, M1, M1 + "import { NexusState } from './modules/state.mjs';\n", 'M1');
    m = rep(m, M2, M2 + 'window.NexusState = NexusState;\n', 'M2');
    fs.writeFileSync(path.join(repo, 'frontend/modules/state.mjs'), 'export const NexusState = { agentOrder: [] };\n');
  }
  if (B) {
    h = rep(h, A1, '/* agentOrder: owned by modules/state.mjs (PROTOTYPE PB; bare name served by a window accessor) */\n', 'A1');
    m = rep(m, M1, M1 + "import { installGlobalStateAccessors } from './modules/state.mjs';\n", 'M1');
    m = rep(m, M2, M2 + 'installGlobalStateAccessors(window);\n', 'M2');
    const setter = variant === 'MUT-PB' ? 'set(v) { /* MUTANT: no-op */ }' : 'set(v) { agentOrder = v; }';
    fs.writeFileSync(path.join(repo, 'frontend/modules/state.mjs'),
      `let agentOrder = [];\nexport function installGlobalStateAccessors(target) {\n  Object.defineProperty(target, 'agentOrder', { configurable: true, enumerable: false, get() { return agentOrder; }, ${setter} });\n}\n`);
  }
  if (variant === 'PB-C3') {
    // C3 sizing: the SAME shim applied to the two big variables. Only the two declarations are removed.
    const D1 = "let selectedAgentIds = ['general'];\n";
    const D2 = 'let messages = []; // {role, agentId, agentName, content, type}\n';
    h = rep(h, D1, '/* selectedAgentIds: owned by modules/state.mjs (PROTOTYPE PB-C3) */\n', 'D1');
    h = rep(h, D2, '/* messages: owned by modules/state.mjs (PROTOTYPE PB-C3) */\n', 'D2');
    m = rep(m, M1, M1 + "import { installGlobalStateAccessors } from './modules/state.mjs';\n", 'M1');
    m = rep(m, M2, M2 + 'installGlobalStateAccessors(window);\n', 'M2');
    fs.writeFileSync(path.join(repo, 'frontend/modules/state.mjs'),
      "let selectedAgentIds = ['general'];\nlet messages = [];\nexport function installGlobalStateAccessors(target) {\n" +
      "  Object.defineProperty(target, 'selectedAgentIds', { configurable: true, enumerable: false, get() { return selectedAgentIds; }, set(v) { selectedAgentIds = v; } });\n" +
      "  Object.defineProperty(target, 'messages', { configurable: true, enumerable: false, get() { return messages; }, set(v) { messages = v; } });\n}\n");
  }
  fs.writeFileSync(hp, h); fs.writeFileSync(mp, m);
}

function run(cmd, args, cwd, env, timeout) {
  const r = spawnSync(cmd, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const failedNames = (out) => [...out.matchAll(/^\[FAIL\] (?:\w+ )?([^\s—]+)/gm)].map((x) => x[1]);
function checks(out) {
  let m = out.match(/(\d+)\/(\d+) (?:validity )?checks passed/);
  if (m) return { passed: +m[1], total: +m[2] };
  m = out.match(/ACCEPTANCE: (\d+)\/(\d+)/);
  if (m) return { passed: +m[1], total: +m[2] };
  const t = (out.match(/"ok": true/g) || []).length, f = (out.match(/"ok": false/g) || []).length;
  return { passed: t, total: t + f };
}

const results = { base: git(ROOT, 'rev-parse', 'HEAD').trim(), variants: {} };
const prodBefore = { html: sh(path.join(ROOT, HTML)), main: sh(path.join(ROOT, 'frontend/main.js')) };

for (const v of ONLY) {
  const repo = path.join(TMP, v.toLowerCase());
  fs.rmSync(repo, { recursive: true, force: true });
  git(TMP, 'clone', '-q', ROOT, repo);
  // symlink heavy untracked dirs (ignored by .gitignore)
  fs.symlinkSync(path.join(ROOT, 'frontend/node_modules'), path.join(repo, 'frontend/node_modules'));
  fs.symlinkSync(path.join(ROOT, 'e2e/node_modules'), path.join(repo, 'e2e/node_modules'));
  // commit 1: harness only (E2E FRONTEND_DIR -> the clone; probe copied in)
  for (const s of SUITES) {
    const p = path.join(repo, 'e2e', s + '.mjs');
    const src = fs.readFileSync(p, 'utf8');
    once(src, "'/home/claude/nexus-v5/frontend'", s);
    fs.writeFileSync(p, src.replace("'/home/claude/nexus-v5/frontend'", JSON.stringify(path.join(repo, 'frontend'))));
  }
  fs.copyFileSync(path.join(here, 'phase2-core-slice9-ownership-probe.mjs'), path.join(repo, 'e2e/phase2-core-slice9-ownership-probe.mjs'));
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'harness');
  // commit 2: the prototype patch
  patch(v, repo);
  git(repo, 'add', '-A'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'prototype ' + v);
  const numstat = git(repo, 'diff', '--numstat', 'HEAD~1', 'HEAD').trim().split('\n').filter(Boolean)
    .map((l) => { const [a, d, f] = l.split('\t'); return { file: f, added: +a, deleted: +d }; });
  const r = { patch: numstat };
  console.log(`\n##### ${v}: patch ${JSON.stringify(numstat)}`);

  const vt = run('npx', ['vitest', 'run'], path.join(repo, 'frontend'), {}, 280000);
  const vm = vt.out.match(/Tests\s+(?:(\d+) failed \| )?(\d+) passed \((\d+)\)/);
  r.vitest = vm ? { failed: +(vm[1] || 0), passed: +vm[2], total: +vm[3] } : { raw: vt.out.slice(-300) };
  console.log('vitest', JSON.stringify(r.vitest));

  r.e2e = {};
  for (const s of SUITES) {
    const o = run('node', [s + '.mjs'], path.join(repo, 'e2e'), { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' }, 290000);
    r.e2e[s] = { ...checks(o.out), exit: o.code, failed: failedNames(o.out) };
    console.log(s, JSON.stringify(r.e2e[s]));
  }
  if ((process.env.S9_EXTRA || 'CTRL,PB,PB-C3').split(',').includes(v)) {
    r.e2eExtra = {};
    for (const n of [5, 6, 7, 8]) {
      const s = `phase2-core-slice${n}-flows`;
      const o = run('node', [s + '.mjs'], path.join(repo, 'e2e'),
        { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', [`NEXUS_S${n}_RESULTS`]: path.join(TMP, `${v}-s${n}.json`) }, 290000);
      const verdict = (o.out.match(/S\d-VERDICT = ([A-Z-]+)|I1-VERDICT = ([A-Z-]+)/) || []).slice(1).find(Boolean) || null;
      const parts = [...o.out.matchAll(/^(VALID|PRES|PS): (\d+\/\d+)$/gm)].map((x) => `${x[1]} ${x[2]}`).join(', ');
      r.e2eExtra[s] = { ...checks(o.out), parts: parts || null, verdict, exit: o.code, failed: failedNames(o.out) };
      console.log(s, JSON.stringify(r.e2eExtra[s]));
    }
  }
  const po = run('node', ['phase2-core-slice9-ownership-probe.mjs'], path.join(repo, 'e2e'),
    { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers', S9_FRONTEND_DIR: path.join(repo, 'frontend') }, 200000);
  const ob = po.out.match(/OBSERVED-JSON (.*)/);
  r.probe = { ...checks(po.out), exit: po.code, failed: failedNames(po.out), observed: ob ? JSON.parse(ob[1]) : null };
  console.log('probe', JSON.stringify(r.probe));

  const an = run('node', ['baseline/evidence/phase2-core-slice3-state-map.mjs'], repo, { ACORN_DIR: process.env.ACORN_DIR }, 200000);
  r.slice3Analyzer = { ...checks(an.out), exit: an.code, failed: [...an.out.matchAll(/^FAIL\s+(.*)$/gm)].map((x) => x[1].slice(0, 140)) };
  console.log('slice3 analyzer', JSON.stringify(r.slice3Analyzer));
  const s2 = run('node', ['baseline/evidence/phase2-core-slice2-adr003-probe.mjs'], repo, { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' }, 280000);
  r.slice2Probe = { ...checks(s2.out), exit: s2.code, failed: [...s2.out.matchAll(/^\[FAIL\]\s+(.*)$/gm)].map((x) => x[1].slice(0, 140)) };
  console.log('slice2 probe', JSON.stringify(r.slice2Probe));
  results.variants[v] = r;
}

const prodAfter = { html: sh(path.join(ROOT, HTML)), main: sh(path.join(ROOT, 'frontend/main.js')) };
results.productionUnchanged = JSON.stringify(prodBefore) === JSON.stringify(prodAfter);
results.productionSha256 = prodAfter;
fs.writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
console.log('\nproduction monolith/main.js sha256 unchanged:', results.productionUnchanged);
console.log('results ->', OUT);
