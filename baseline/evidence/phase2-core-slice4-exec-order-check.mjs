// Core slice 4 / C1 — AC-6: static top-level execution-order check (ADR-002 "Consequences").
// Question: can ANY load-time code of the classic script (everything that runs before main.js, which is
// deferred) reach snapshotPersistableState / restorePersistableState / resetPersistableState — directly,
// through synchronous calls, or (over-approximation) through callbacks/handlers registered at load time?
// If yes, the bridge (window.PersistableStateCore, assigned in main.js) might not exist yet.
//
// READ-ONLY. acorn is not a repo dependency:  npm i acorn@8.19.0  in a scratch dir, then
//   ACORN_DIR=<dir containing node_modules/acorn> node baseline/evidence/phase2-core-slice4-exec-order-check.mjs
// Writes baseline/evidence/phase2-core-slice4-exec-order-results.json (deterministic, no timestamps).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(process.env.ACORN_DIR || '.', 'noop.js'));
const acorn = require('acorn');
const HTML = fs.readFileSync(path.join(ROOT, 'frontend/neural_nexus_ai_agents-4-3-5-3.html'), 'utf8');
const MAINJS = fs.readFileSync(path.join(ROOT, 'frontend/main.js'), 'utf8');
const TARGETS = ['snapshotPersistableState', 'restorePersistableState', 'resetPersistableState'];

const scripts = [...HTML.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts.find((s) => s.includes('async function autoInitApp'));
if (!code) throw new Error('main classic script not found');
const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });

const checks = []; const rec = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };

const fns = new Map(); // top-level function declarations
for (const n of ast.body) if (n.type === 'FunctionDeclaration') fns.set(n.id.name, n);

function walk(node, visit, opts = {}) {
  // visit(node, ctx) -> return false to not descend. opts.intoFunctions: descend into nested function bodies
  const stack = [{ n: node, depth: 0 }];
  while (stack.length) {
    const { n, depth } = stack.pop();
    if (!n || typeof n.type !== 'string') continue;
    const isFn = n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration';
    if (visit(n, depth, isFn) === false) continue;
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) for (const c of v) { if (c && typeof c.type === 'string') stack.push({ n: c, depth: depth + (isFn ? 1 : 0) }); }
      else if (v && typeof v.type === 'string') stack.push({ n: v, depth: depth + (isFn ? 1 : 0) });
    }
  }
}
// names called/referenced inside `node`.  mode 'strict': direct sync calls only (nested function bodies NOT entered,
// except IIFEs); 'loose': also nested callbacks and bare identifier references to top-level functions.
function reach(node, mode) {
  const names = new Set();
  walk(node, (n, depth, isFn) => {
    if (n.type === 'CallExpression') {
      if (n.callee.type === 'Identifier') names.add(n.callee.name);
      if (n.callee.type === 'MemberExpression' && n.callee.object.type === 'Identifier' && n.callee.object.name === 'window' && n.callee.property.type === 'Identifier') names.add(n.callee.property.name);
    }
    if (mode === 'loose' && n.type === 'Identifier' && fns.has(n.name)) names.add(n.name);
    if (isFn && n !== node) {
      if (mode === 'strict') return false;
    }
    return true;
  });
  return names;
}
function closure(seed, mode) {
  const seen = new Map(); // name -> parent (for a path)
  const queue = [];
  for (const s of seed) { if (!seen.has(s)) { seen.set(s, null); queue.push(s); } }
  while (queue.length) {
    const cur = queue.shift();
    const fn = fns.get(cur);
    if (!fn) continue;
    for (const nx of reach(fn.body, mode)) if (!seen.has(nx)) { seen.set(nx, cur); queue.push(nx); }
  }
  return seen;
}
const pathTo = (seen, name) => { const p = []; for (let c = name; c != null; c = seen.get(c)) p.unshift(c); return p; };

// ---- load-time statements (everything at top level that is not a function declaration) ----------------
const loadSeedStrict = new Set(); const loadSeedLoose = new Set(); let loadStatements = 0;
const loadRefsCore = [];
for (const n of ast.body) {
  if (n.type === 'FunctionDeclaration') continue;
  loadStatements++;
  for (const nm of reach(n, 'strict')) loadSeedStrict.add(nm);
  for (const nm of reach(n, 'loose')) loadSeedLoose.add(nm);
  walk(n, (x, d, isFn) => { if (x.type === 'Identifier' && (x.name === 'PersistableStateCore' || TARGETS.includes(x.name)) && !isFn) loadRefsCore.push(x.name); return true; });
}
const strict = closure(loadSeedStrict, 'strict');
const loose = closure(loadSeedLoose, 'loose');
rec('A1 load-time statements analysed', loadStatements > 0, `${loadStatements} top-level non-function statements; ${fns.size} top-level functions`);
rec('A2 no load-time statement mentions the 3 functions or PersistableStateCore directly', loadRefsCore.length === 0, JSON.stringify(loadRefsCore));
const strictHit = TARGETS.filter((t) => strict.has(t));
rec('A3 strict (synchronous-call) closure from load time does NOT reach the 3 functions', strictHit.length === 0, `strict closure size=${strict.size}; hits=${JSON.stringify(strictHit)}`);
const looseHit = TARGETS.filter((t) => loose.has(t));
console.log('INFO loose (callback/handler over-approximation) closure size=' + loose.size + '; hits=' + JSON.stringify(looseHit.map((t) => pathTo(loose, t).join(' > '))));

// ---- is `persistState` (the only loose-reachable gateway?) guarded by encryptionKey? -------------------
const callersOf = (name) => [...fns.keys()].filter((f) => reach(fns.get(f).body, 'loose').has(name));
const callers = Object.fromEntries(TARGETS.map((t) => [t, callersOf(t).sort()]));
rec('A4 callers of the 3 functions (static)', true, JSON.stringify(callers));
const ps = fns.get('persistState');
const first = ps.body.body[0];
const guarded = first && first.type === 'IfStatement' && first.test.type === 'UnaryExpression' && first.test.operator === '!' &&
  first.test.argument.type === 'Identifier' && first.test.argument.name === 'encryptionKey' &&
  (first.consequent.type === 'ReturnStatement' || (first.consequent.type === 'BlockStatement' && first.consequent.body[0]?.type === 'ReturnStatement'));
rec('A5 persistState begins with `if(!encryptionKey) return;` (nothing reaches snapshot before the key exists)', guarded, '');
// every assignment to encryptionKey: which top-level function encloses it?
const assigners = new Set(); let declInit = null;
for (const n of ast.body) {
  if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.name === 'encryptionKey') declInit = code.slice(d.start, d.end);
  const owner = n.type === 'FunctionDeclaration' ? n.id.name : '<load-time>';
  walk(n, (x) => { if (x.type === 'AssignmentExpression' && x.left.type === 'Identifier' && x.left.name === 'encryptionKey') assigners.add(owner); return true; });
}
rec('A6 encryptionKey is assigned only inside autoInitApp (init `' + declInit + '`)', assigners.size === 1 && assigners.has('autoInitApp'), JSON.stringify([...assigners]));
// the other callers of the 3 functions: are they reachable from load-time at all?
const others = ['pushSync', 'pullSyncIfNewer', 'resolveSyncConflict', 'resetAllData', 'autoInitApp'];
const othersLoose = others.filter((o) => loose.has(o)).map((o) => pathTo(loose, o).join(' > '));
console.log('INFO other callers reachable in the loose closure: ' + JSON.stringify(othersLoose));

// ---- startup order in main.js: bridge precedes the 5 startup calls ------------------------------------
const iBridge = MAINJS.indexOf('window.PersistableStateCore = ');
const startupIdx = ['window.applyTheme();', 'window.applyTranslations();', 'window.autoInitApp();', 'window.registerServiceWorker();', 'window.updateOnlineStatus()'].map((s) => MAINJS.indexOf(s)); // slice 6 (I-1/O2): the last call is now `bootInit.finally(() => window.updateOnlineStatus());`, so the needle drops the trailing `;` — the assertion (found AND after the bridge) is unchanged
rec('A7 main.js: window.PersistableStateCore assigned BEFORE all 5 startup calls', iBridge > 0 && startupIdx.every((i) => i > iBridge), JSON.stringify({ iBridge, startupIdx }));
// the only sync path from the 5 startup calls to the 3 functions
const startupSeed = ['applyTheme', 'applyTranslations', 'autoInitApp', 'registerServiceWorker', 'updateOnlineStatus'];
const startupClosure = closure(new Set(startupSeed), 'strict');
console.log('INFO sync paths from the 5 startup calls: ' + JSON.stringify(TARGETS.filter((t) => startupClosure.has(t)).map((t) => pathTo(startupClosure, t).join(' > '))));
// the 3 wrappers are the only code that mentions PersistableStateCore, and each is a single statement
const coreUsers = [...fns.keys()].filter((f) => { let hit = false; walk(fns.get(f).body, (x) => { if (x.type === 'Identifier' && x.name === 'PersistableStateCore') hit = true; return true; }); return hit; }).sort();
rec('A8 PersistableStateCore is referenced only by the 3 wrappers', JSON.stringify(coreUsers) === JSON.stringify([...TARGETS].sort()), JSON.stringify(coreUsers));
rec('A9 each wrapper body is exactly one statement', TARGETS.every((t) => fns.get(t).body.body.length === 1), '');

const failed = checks.filter((c) => !c.ok);
const out = {
  slice: 'core-slice-4/C1', checks, summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name) },
  info: {
    looseClosureHits: looseHit.map((t) => pathTo(loose, t)), strictClosureSize: strict.size, looseClosureSize: loose.size,
    callers, otherCallersInLooseClosure: othersLoose,
    startupSyncPaths: TARGETS.filter((t) => startupClosure.has(t)).map((t) => pathTo(startupClosure, t)),
  },
};
if (!process.env.NO_WRITE) fs.writeFileSync(path.join(ROOT, 'baseline/evidence/phase2-core-slice4-exec-order-results.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n=== EXECUTION-ORDER CHECK: ${out.summary.passed}/${out.summary.total} ===`);
if (failed.length) console.log('FAILED: ' + out.summary.failed.join(', '));
process.exit(failed.length ? 1 : 0);
