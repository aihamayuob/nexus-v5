// Phase 2 / boundary 5 "core" / slice 3 — READ-ONLY ownership / initialization /
// mutation map of PERSISTABLE_STATE and its 16 wrapped state variables.
//
// STRICTLY READ-ONLY with respect to production: it only READS the monolith and
// main.js, never writes or executes them. It writes ONLY its own two evidence
// files next to itself. Self-locating (no hard-coded repo path).
//
// Needs `acorn` (8.x). It is NOT a repo dependency; install it OUTSIDE the repo
// and point ACORN_DIR at that directory:
//   npm i --prefix "$SCRATCH/acorn" acorn@8
//   ACORN_DIR="$SCRATCH/acorn" node baseline/evidence/phase2-core-slice3-state-map.mjs
//
// Method (all STATIC / syntactic — see "limits" in the output):
//  * parse every inline classic <script> with acorn (sourceType:'script'),
//  * scope-aware resolution of identifier references (local shadowing excluded),
//  * classify each reference: rebind | mutate | read | escape,
//  * build a unit-level call/reference graph (a "unit" = one top-level statement),
//  * compute reachability from load-time code, main.js startup calls, and inline
//    handlers (HTML attributes AND on*= attributes embedded in JS strings),
//  * integrity proof (sha256 + git status of production paths before/after),
//  * self-test on synthetic code with known answers + an in-memory sensitivity
//    control on the real monolith (never written to disk).
// Output is deterministic (no timestamps): two runs must be byte-identical.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const HTML_REL = 'frontend/neural_nexus_ai_agents-4-3-5-3.html';
const HTML = path.join(ROOT, HTML_REL);
const MAINJS = path.join(ROOT, 'frontend/main.js');
const OUT_JSON = path.join(here, 'phase2-core-slice3-state-map-results.json');

if (!process.env.ACORN_DIR) { console.error('ACORN_DIR is required (directory containing node_modules/acorn)'); process.exit(2); }
const acorn = createRequire(path.join(process.env.ACORN_DIR, 'noop.js'))('acorn');

const TARGETS = ['messages','customAgents','workflows','knowledgeBase','activeGroupId','agentOrder','selectedAgentIds','projects','decisionJournal','topicMonitors','longTermMemory','uploadedDocs','activityLog','errorLog','usageLog','briefingLastSeenAt'];
// Core slice 10 (CP-18 / ADR-005): variables whose VALUE is owned by modules/state.mjs (global-accessor mechanism) have NO classic top-level declaration.
// They are checked separately (check below) instead of by the `let`-declaration facts; every other check still runs on all 16.
const S10_OWNED = new Set(['agentOrder']);
const MUTATORS = new Set(['push','pop','shift','unshift','splice','sort','reverse','fill','copyWithin','add','delete','clear','set']);
const PERSIST_FUNCS = ['PERSISTABLE_STATE','snapshotPersistableState','restorePersistableState','resetPersistableState','persistState','autoInitApp','resetAllData'];

// ------------------------------------------------------------------ helpers
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const isFn = (n) => n && (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression');

function walk(node, anc, fn) {
  fn(node, anc);
  anc.push(node);
  for (const k in node) {
    if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') walk(c, anc, fn); }
    else if (v && typeof v.type === 'string') walk(v, anc, fn);
  }
  anc.pop();
}

function patternNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case 'Identifier': out.add(p.name); break;
    case 'ObjectPattern': for (const pr of p.properties) patternNames(pr.type === 'RestElement' ? pr.argument : pr.value, out); break;
    case 'ArrayPattern': for (const e of p.elements) patternNames(e, out); break;
    case 'AssignmentPattern': patternNames(p.left, out); break;
    case 'RestElement': patternNames(p.argument, out); break;
  }
  return out;
}

function collectVarNames(node, out) { // var-hoisted + sloppy block-function names, not entering nested functions
  walk(node, [], (n) => {
    if (n !== node && isFn(n)) { if (n.type === 'FunctionDeclaration' && n.id) out.add(n.id.name); return; }
    if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) patternNames(d.id, out);
  });
  return out;
}
// walk() cannot "skip subtree", so var collection filters nested-function content afterwards:
function collectVarNamesShallow(fnNode) {
  const out = new Set();
  const visit = (n, depth) => {
    if (!n || typeof n.type !== 'string') return;
    if (depth > 0 && isFn(n)) { if (n.type === 'FunctionDeclaration' && n.id) out.add(n.id.name); return; }
    if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) patternNames(d.id, out);
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, depth + (n === fnNode ? 0 : 0)));
      else if (v && typeof v.type === 'string') visit(v, depth + (n === fnNode ? 0 : 0));
    }
  };
  // depth is 0 only for the function node itself; children use depth 1 so nested functions are skipped
  const visitChildren = (n) => {
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'type') continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, 1));
      else if (v && typeof v.type === 'string') visit(v, 1);
    }
  };
  visitChildren(fnNode);
  return out;
}

const declMemo = new WeakMap();
function scopeDecls(n) {
  if (declMemo.has(n)) return declMemo.get(n);
  const s = new Set();
  const lexicalIn = (stmts) => {
    for (const st of stmts) {
      if (st.type === 'VariableDeclaration' && st.kind !== 'var') for (const d of st.declarations) patternNames(d.id, s);
      else if (st.type === 'FunctionDeclaration' && st.id) s.add(st.id.name);
      else if (st.type === 'ClassDeclaration' && st.id) s.add(st.id.name);
    }
  };
  if (isFn(n)) {
    for (const p of n.params) patternNames(p, s);
    if (n.type === 'FunctionExpression' && n.id) s.add(n.id.name);
    s.add('arguments');
    for (const v of collectVarNamesShallow(n)) s.add(v);
    if (n.body && n.body.type === 'BlockStatement') lexicalIn(n.body.body);
  } else if (n.type === 'BlockStatement') lexicalIn(n.body);
  else if (n.type === 'ForStatement') { if (n.init && n.init.type === 'VariableDeclaration' && n.init.kind !== 'var') for (const d of n.init.declarations) patternNames(d.id, s); }
  else if (n.type === 'ForInStatement' || n.type === 'ForOfStatement') { if (n.left.type === 'VariableDeclaration' && n.left.kind !== 'var') for (const d of n.left.declarations) patternNames(d.id, s); }
  else if (n.type === 'CatchClause') patternNames(n.param, s);
  else if (n.type === 'SwitchStatement') for (const c of n.cases) lexicalIn(c.consequent);
  declMemo.set(n, s);
  return s;
}
const isShadowed = (name, anc) => { for (let i = 1; i < anc.length; i++) if (scopeDecls(anc[i]).has(name)) return true; return false; };

function isDeclTarget(node, anc) {
  let cur = node;
  for (let i = anc.length - 1; i >= 0; i--) {
    const p = anc[i];
    if (p.type === 'VariableDeclarator') return p.id === cur;
    if (p.type === 'FunctionDeclaration' || p.type === 'FunctionExpression' || p.type === 'ArrowFunctionExpression') return p.params.includes(cur) || p.id === cur;
    if (p.type === 'ClassDeclaration' || p.type === 'ClassExpression') return p.id === cur;
    if (p.type === 'CatchClause') return p.param === cur;
    if (p.type === 'AssignmentPattern') { if (p.left !== cur) return false; cur = p; continue; }
    if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern' || p.type === 'RestElement') { cur = p; continue; }
    if (p.type === 'Property') { if (anc[i - 1] && anc[i - 1].type === 'ObjectPattern' && p.value === cur) { cur = p; continue; } return false; }
    return false;
  }
  return false;
}

const keyName = (k) => (k.type === 'Identifier' ? k.name : k.type === 'Literal' ? String(k.value) : '<computed>');

// ------------------------------------------------------------------ core analyzer
// ctx: { code, tagLine, idx }
function analyzeProgram(program, ctx, targets, unitNames) {
  const refs = [];      // references to TARGET variables
  const edges = [];     // unit graph edges
  const line = (n) => ctx.tagLine + n.loc.start.line - 1;
  const text = (n, max = 80) => ctx.code.slice(n.start, n.end).replace(/\s+/g, ' ').slice(0, max);

  const unitOfStmt = (st) => {
    if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') return st.id.name;
    if (st.type === 'VariableDeclaration') return st.declarations.map((d) => (d.id.type === 'Identifier' ? d.id.name : '<pattern>')).join(',');
    return `<top@${line(st)}:${st.type}>`;
  };
  const fnLabelAt = (anc, k) => {
    const f = anc[k], p = anc[k - 1];
    if (f.type === 'FunctionDeclaration') return f.id.name;
    if (p && p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
    if (p && (p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition')) {
      const names = [];
      for (let j = k - 1; j >= 1; j--) {
        const a = anc[j];
        if (a.type === 'Property' || a.type === 'MethodDefinition' || a.type === 'PropertyDefinition') names.unshift(keyName(a.key));
        else if (a.type === 'VariableDeclarator') { names.unshift(a.id.type === 'Identifier' ? a.id.name : '<pattern>'); break; }
        else if (a.type === 'AssignmentExpression') { names.unshift(text(a.left, 40)); break; }
        else if (isFn(a)) break;
      }
      return names.join('.');
    }
    if (p && p.type === 'CallExpression' && p.arguments.includes(f)) return `<callback@${line(f)}:${text(p.callee, 32)}>`;
    return `<anon@${line(f)}>`;
  };
  const fnChain = (anc) => { const out = []; for (let k = 1; k < anc.length; k++) if (isFn(anc[k])) out.push(fnLabelAt(anc, k)); return out; };
  const isLoadTime = (anc) => {
    for (let k = 1; k < anc.length; k++) {
      if (isFn(anc[k])) {
        const p = anc[k - 1];
        const iife = p && p.type === 'CallExpression' && p.callee === anc[k];
        if (!iife) return false;
      }
    }
    return true;
  };

  // number of NON-IIFE function ancestors: 0 = top-level code, 1 = directly in a top-level function body,
  // >=2 = inside a nested callback/closure (executes later, when that closure is invoked — i.e. DEFERRED)
  const fnDepthOf = (anc) => { let d = 0; for (let k = 1; k < anc.length; k++) if (isFn(anc[k])) { const p = anc[k - 1]; if (!(p && p.type === 'CallExpression' && p.callee === anc[k])) d++; } return d; };
  const climbValueCtx = (node, anc) => { // skip through transparent expression wrappers
    let cur = node, i = anc.length - 1;
    while (i >= 0) {
      const p = anc[i];
      if (p.type === 'LogicalExpression') { cur = p; i--; continue; }
      if (p.type === 'ConditionalExpression' && p.test !== cur) { cur = p; i--; continue; }
      if (p.type === 'SequenceExpression' && p.expressions[p.expressions.length - 1] === cur) { cur = p; i--; continue; }
      break;
    }
    return { cur, parent: anc[i], gp: anc[i - 1] };
  };

  walk(program, [], (node, anc) => {
    if (node.type !== 'Identifier') return;
    const parent = anc[anc.length - 1];
    if (!parent) return;
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return;
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return;
    if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === node && !parent.computed) return;
    if ((parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') && parent.label === node) return;
    if (isDeclTarget(node, anc)) return;
    const name = node.name;
    const isTarget = targets.has(name), isUnit = unitNames.has(name), isWindow = name === 'window';
    if (!isTarget && !isUnit && !isWindow) return;
    if (isShadowed(name, anc)) return;

    const top = anc[1];
    const unit = top ? unitOfStmt(top) : '<program>';
    const loadTime = isLoadTime(anc);

    // ---- unit graph edges (call vs plain reference) ----
    if (isUnit) {
      const isCall = (parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee === node;
      edges.push({ from: unit, to: name, kind: isCall ? 'call' : 'ref', loadTime, fnDepth: fnDepthOf(anc), line: line(node) });
    }
    if (isWindow && parent.type === 'MemberExpression' && parent.object === node && !parent.computed && unitNames.has(parent.property.name)) {
      const gp = anc[anc.length - 2];
      const isCall = gp && gp.type === 'CallExpression' && gp.callee === parent;
      edges.push({ from: unit, to: parent.property.name, kind: isCall ? 'call' : 'ref', loadTime, fnDepth: fnDepthOf(anc), line: line(node), viaWindow: true });
    }
    if (!isTarget) return;

    // ---- classify reference to a TARGET variable ----
    const base = { name, line: line(node), col: node.loc.start.column, script: ctx.idx, unit, fn: fnChain(anc).join(' > ') || null, loadTime };
    // 1) rebind: assignment / update / for-in-of / destructuring-assignment target
    {
      let cur = node;
      for (let i = anc.length - 1; i >= 0; i--) {
        const p = anc[i];
        if (p.type === 'AssignmentExpression' && p.left === cur) { refs.push({ ...base, kind: 'rebind', op: p.operator, compound: p.operator !== '=' }); return; }
        if (p.type === 'UpdateExpression' && p.argument === cur) { refs.push({ ...base, kind: 'rebind', op: p.operator, compound: true }); return; }
        if ((p.type === 'ForInStatement' || p.type === 'ForOfStatement') && p.left === cur) { refs.push({ ...base, kind: 'rebind', op: p.type, compound: false }); return; }
        if (p.type === 'AssignmentPattern' && p.left === cur) { cur = p; continue; }
        if (p.type === 'ObjectPattern' || p.type === 'ArrayPattern' || p.type === 'RestElement') { cur = p; continue; }
        if (p.type === 'Property' && anc[i - 1] && anc[i - 1].type === 'ObjectPattern' && p.value === cur) { cur = p; continue; }
        break;
      }
    }
    // 2) member-rooted: in-place mutation or plain member read
    if (parent.type === 'MemberExpression' && parent.object === node) {
      let chain = parent, depth = 1, i = anc.length - 2;
      while (i >= 0 && anc[i].type === 'MemberExpression' && anc[i].object === chain) { chain = anc[i]; depth++; i--; }
      const p = anc[i];
      const nested = depth > 1;
      if (p && p.type === 'AssignmentExpression' && p.left === chain) { refs.push({ ...base, kind: 'mutate', detail: 'member-assign', nested, path: text(chain, 60) }); return; }
      if (p && p.type === 'UpdateExpression' && p.argument === chain) { refs.push({ ...base, kind: 'mutate', detail: 'member-update', nested, path: text(chain, 60) }); return; }
      if (p && p.type === 'UnaryExpression' && p.operator === 'delete' && p.argument === chain) { refs.push({ ...base, kind: 'mutate', detail: 'delete', nested, path: text(chain, 60) }); return; }
      if (p && p.type === 'CallExpression' && p.callee === chain && chain.property && !chain.computed && MUTATORS.has(chain.property.name)) { refs.push({ ...base, kind: 'mutate', detail: `method:${chain.property.name}`, nested, path: text(chain, 60) }); return; }
      refs.push({ ...base, kind: 'read', detail: 'member-read' });
      return;
    }
    // 3) bare identifier: escape (alias/pass/return/store) vs plain read
    const { cur, parent: cp } = climbValueCtx(node, anc);
    let esc = null;
    if (cp) {
      if ((cp.type === 'CallExpression' || cp.type === 'NewExpression') && cp.arguments.includes(cur)) esc = 'arg';
      else if (cp.type === 'VariableDeclarator' && cp.init === cur) esc = 'alias';
      else if (cp.type === 'AssignmentExpression' && cp.right === cur) esc = 'alias';
      else if (cp.type === 'ReturnStatement') esc = 'return';
      else if (cp.type === 'ArrowFunctionExpression' && cp.body === cur) esc = 'return';
      else if (cp.type === 'Property' && cp.value === cur) esc = 'object';
      else if (cp.type === 'ArrayExpression') esc = 'array';
    }
    refs.push(esc ? { ...base, kind: 'escape', detail: esc } : { ...base, kind: 'read', detail: 'bare' });
  });
  return { refs, edges, unitOfStmt, line, text, fnChain, isLoadTime };
}

// ------------------------------------------------------------------ script extraction
function extractScripts(html) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const out = []; let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const tagStart = m.index;
    const tagLine = html.slice(0, tagStart).split('\n').length; // line of the <script> tag == line of content start
    const body = m[2];
    out.push({ idx: out.length, attrs: attrs.trim(), src: /\bsrc\s*=/.test(attrs), type: (/type\s*=\s*"([^"]*)"/.exec(attrs) || [])[1] || 'classic', tagLine, code: body, nLines: body.split('\n').length, bodyStart: m.index + m[0].indexOf('>') + 1, bodyEnd: m.index + m[0].indexOf('>') + 1 + body.length });
  }
  return out;
}
function maskScripts(html, scripts) {
  let s = html;
  for (const sc of [...scripts].reverse()) s = s.slice(0, sc.bodyStart) + s.slice(sc.bodyStart, sc.bodyEnd).replace(/[^\n]/g, ' ') + s.slice(sc.bodyEnd);
  return s;
}

// ------------------------------------------------------------------ full analysis of an HTML text
function analyzeHtml(html, mainJsText) {
  const scripts = extractScripts(html);
  const classic = scripts.filter((s) => !s.src && s.type === 'classic');
  const parsed = classic.map((s) => ({ s, ast: acorn.parse(s.code, { ecmaVersion: 'latest', sourceType: 'script', locations: true }) }));

  // --- global (top-level) inventory across inline classic scripts, in order
  const globals = new Map();            // name -> {kind, line, script, col0, init, multi}
  const unitsByName = new Map();        // unit name -> {line, kind, script}
  const topStmts = [];                  // every top-level statement (for load-time root analysis)
  for (const { s, ast } of parsed) {
    const dummy = analyzeProgram({ type: 'Program', body: [], loc: { start: { line: 1, column: 0 } } }, { code: s.code, tagLine: s.tagLine, idx: s.idx }, new Set(), new Set());
    for (const st of ast.body) {
      const ln = s.tagLine + st.loc.start.line - 1;
      const unitName = dummy.unitOfStmt ? null : null; void unitName;
      if (st.type === 'FunctionDeclaration' || st.type === 'ClassDeclaration') { globals.set(st.id.name, { kind: st.type === 'FunctionDeclaration' ? 'function' : 'class', line: ln, script: s.idx, col0: st.loc.start.column === 0 }); }
      else if (st.type === 'VariableDeclaration') {
        const names = st.declarations.map((d) => (d.id.type === 'Identifier' ? d.id.name : null)).filter(Boolean);
        for (const d of st.declarations) { if (d.id.type !== 'Identifier') { for (const n of patternNames(d.id, new Set())) globals.set(n, { kind: st.kind, line: ln, script: s.idx, col0: st.loc.start.column === 0, pattern: true }); continue; }
          globals.set(d.id.name, { kind: st.kind, line: ln, script: s.idx, col0: st.loc.start.column === 0, init: d.init ? s.code.slice(d.init.start, d.init.end).replace(/\s+/g, ' ').slice(0, 120) : null, multi: names.length > 1 ? names : null, dupCount: (globals.get(d.id.name)?.dupCount || 0) + 1 }); }
      }
    }
  }
  const unitNames = new Set(globals.keys());
  const targets = new Set(TARGETS);

  const refs = [], edges = [];
  const unitInfo = new Map(); // unit -> {line, script, types:Set, loadTimeCalls:[]}
  const helperByScript = new Map();
  for (const { s, ast } of parsed) {
    const r = analyzeProgram(ast, { code: s.code, tagLine: s.tagLine, idx: s.idx }, targets, unitNames);
    helperByScript.set(s.idx, r);
    refs.push(...r.refs); edges.push(...r.edges);
    for (const st of ast.body) {
      const u = r.unitOfStmt(st);
      const rec = unitInfo.get(u) || { unit: u, line: r.line(st), endLine: s.tagLine + st.loc.end.line - 1, script: s.idx, stmtType: st.type };
      unitInfo.set(u, rec);
      topStmts.push({ u, st, script: s.idx });
    }
  }

  // --- inline handlers: HTML attributes + on*= inside JS string/template literals
  const handlers = [];
  const attrRe = /\bon([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const masked = maskScripts(html, scripts);
  let am;
  while ((am = attrRe.exec(masked))) {
    handlers.push({ src: 'html', event: am[1], code: am[2] ?? am[3], line: masked.slice(0, am.index).split('\n').length });
  }
  for (const { s, ast } of parsed) {
    walk(ast, [], (n) => {
      let txt = null;
      if (n.type === 'Literal' && typeof n.value === 'string') txt = n.value;
      else if (n.type === 'TemplateElement') txt = n.value.cooked ?? n.value.raw;
      if (!txt || txt.length < 8) return;
      let m2; const re2 = /\bon([a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
      while ((m2 = re2.exec(txt))) handlers.push({ src: 'js-string', event: m2[1], code: m2[2] ?? m2[3], line: s.tagLine + n.loc.start.line - 1 });
    });
  }
  // NOTE (honest record): the first draft matched variable names inside handler text WITHOUT removing string
  // literals, which produced 2 FALSE POSITIVES (`openWorkspace('projects')`, `switchWorkspaceTab('projects')` —
  // 'projects' there is a string argument, not the variable). Quoted strings are now stripped before matching.
  const handlerVarRefs = (code) => {
    const noStr = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
    return TARGETS.filter((v) => new RegExp(`(?<![\\w$.])${v}(?![\\w$])`).test(noStr));
  };
  const callRe = /(?:window\.)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const h of handlers) {
    h.calls = [...new Set([...h.code.matchAll(callRe)].map((x) => x[1]).filter((n) => unitNames.has(n)))];
    h.varRefs = handlerVarRefs(h.code);
  }

  // --- startup calls from main.js (module, runs after classic scripts)
  const mainAst = acorn.parse(mainJsText, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const startup = [];
  // Slice 6 (I-1 / O2) wrapped two startup calls (`const bootInit = window.autoInitApp();` and
  // `bootInit.finally(() => window.updateOnlineStatus());`). A top-level-ExpressionStatement-only scan would silently DROP both
  // roots (autoInitApp is the main one) and under-report startup reachability, so every `window.X(...)` call inside a top-level
  // expression/variable statement is collected (nested arrow bodies included = a deliberate over-approximation). `line` stays
  // the line of the top-level statement, as before. Plain `window.X = y` assignments are not calls and are ignored.
  const collectWindowCalls = (node, line) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression') {
      const c = node.callee;
      if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && c.object.name === 'window' && !c.computed) startup.push({ name: c.property.name, line });
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((x) => collectWindowCalls(x, line));
      else if (v && typeof v.type === 'string') collectWindowCalls(v, line);
    }
  };
  for (const st of mainAst.body) if (st.type === 'ExpressionStatement' || st.type === 'VariableDeclaration') collectWindowCalls(st, st.loc.start.line);

  // --- graph + reachability
  const adj = { call: new Map(), any: new Map(), sync: new Map() };
  const add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
  for (const e of edges) { add(adj.any, e.from, e.to); if (e.kind === 'call') { add(adj.call, e.from, e.to); if (e.fnDepth <= 1) add(adj.sync, e.from, e.to); } }
  const reach = (starts, g) => { const seen = new Set(starts); const q = [...starts]; while (q.length) { const u = q.pop(); for (const v of (g.get(u) || [])) if (!seen.has(v)) { seen.add(v); q.push(v); } } return seen; };
  // shortest-path variant (FIFO BFS, sorted neighbours => deterministic) so every "reachable" claim is inspectable
  const reachPaths = (starts, g) => { const prev = new Map(starts.map((x) => [x, null])); const q = [...starts].sort(); while (q.length) { const u = q.shift(); for (const v of [...(g.get(u) || [])].sort()) if (!prev.has(v)) { prev.set(v, u); q.push(v); } } return (target) => { if (!prev.has(target)) return null; const out = []; for (let c = target; c !== null; c = prev.get(c)) out.unshift(c); return out; }; };
  // load-time roots: every top-level statement is executed (declarations of functions are not "executed" but harmless);
  // what matters is CALLS made at load time (outside any function body)
  const loadTimeCallTargets = [...new Set(edges.filter((e) => e.loadTime && e.kind === 'call').map((e) => e.to))];
  const loadTimeRefTargets = [...new Set(edges.filter((e) => e.loadTime && e.kind === 'ref').map((e) => e.to))];
  const startupRoots = startup.map((x) => x.name).filter((n) => unitNames.has(n));
  const loadReachCall = reach(loadTimeCallTargets, adj.call);
  const startupReachCall = reach(startupRoots, adj.call);
  const startupReachAny = reach(startupRoots, adj.any);
  const startupReachSync = reach(startupRoots, adj.sync);
  const startupPath = reachPaths(startupRoots, adj.sync);
  const loadReachSync = reach(loadTimeCallTargets, adj.sync);

  const handlerEntryUnits = [...new Set(handlers.flatMap((h) => h.calls))];
  const handlerReach = new Map(handlerEntryUnits.map((u) => [u, reach([u], adj.any)]));
  const handlerReachSync = new Map(handlerEntryUnits.map((u) => [u, reach([u], adj.sync)]));

  // persistState direct-call fact per unit
  const callsPersist = (u) => (adj.call.get(u) || new Set()).has('persistState');

  // --- per-variable facts
  const psLine = globals.get('PERSISTABLE_STATE')?.line ?? null;
  const vars = {};
  for (const v of TARGETS) {
    const mine = refs.filter((r) => r.name === v);
    const g = globals.get(v) || null;
    const byKind = (k) => mine.filter((r) => r.kind === k);
    const viaSetter = (r) => r.unit === 'PERSISTABLE_STATE';
    const rebindAll = byKind('rebind');
    const rebindExternal = rebindAll.filter((r) => !viaSetter(r));
    const mutates = byKind('mutate');
    const writerUnits = [...new Set([...rebindExternal, ...mutates].map((r) => r.unit))].sort();
    const rebindUnits = [...new Set(rebindExternal.map((r) => r.unit))].sort();
    const readerUnits = [...new Set(byKind('read').concat(byKind('escape')).filter((r) => !viaSetter(r)).map((r) => r.unit))].sort();
    const hDirect = handlers.filter((h) => h.varRefs.includes(v)).map((h) => ({ src: h.src, event: h.event, line: h.line, code: h.code.slice(0, 100) }));
    const hReachWriters = handlerEntryUnits.filter((u) => { const rs = handlerReach.get(u); return writerUnits.some((w) => rs.has(w)); }).sort();
    const hReachWritersSync = handlerEntryUnits.filter((u) => { const rs = handlerReachSync.get(u); return writerUnits.some((w) => rs.has(w)); }).sort();
    vars[v] = {
      declaration: g && { kind: g.kind, line: g.line, script: g.script, col0: g.col0, init: g.init ?? null, sameStatementAs: g.multi ?? null, declaredOnce: (g.dupCount ?? 1) === 1, beforePersistableState: psLine ? g.line < psLine : null },
      counts: {
        rebindSitesOutsideSetter: rebindExternal.length, rebindUnits: rebindUnits.length, rebindFunctionsDistinct: new Set(rebindExternal.map((r) => r.fn)).size,
        rebindViaPersistableStateSetter: rebindAll.length - rebindExternal.length,
        mutateSites: mutates.length, mutateNestedSites: mutates.filter((m) => m.nested).length, mutateUnits: [...new Set(mutates.map((m) => m.unit))].length,
        readSites: byKind('read').length, escapeSites: byKind('escape').length, readerUnits: readerUnits.length,
        loadTimeSites: mine.filter((r) => r.loadTime).length,
      },
      rebindSites: rebindExternal.map(({ line, unit, fn, op, loadTime }) => ({ line, unit, fn, op, loadTime, unitCallsPersistState: callsPersist(unit) })),
      mutateSites: mutates.map(({ line, unit, fn, detail, nested, path: p }) => ({ line, unit, fn, detail, nested, path: p, unitCallsPersistState: callsPersist(unit) })),
      escapeSites: byKind('escape').map(({ line, unit, fn, detail }) => ({ line, unit, fn, detail })),
      loadTimeSites: mine.filter((r) => r.loadTime).map(({ line, unit, kind, detail }) => ({ line, unit, kind, detail })),
      writerUnits, readerUnits,
      writerUnitsNotCallingPersistState: writerUnits.filter((u) => !callsPersist(u)),
      inlineHandlerDirectRefs: hDirect,
      inlineHandlerEntryUnitsReachingAWriter_looseAnyEdges: hReachWriters,
      inlineHandlerEntryUnitsReachingAWriter_syncCalls: hReachWritersSync,
      writersReachableFromStartup_syncCalls: writerUnits.filter((u) => startupReachSync.has(u)),
      startupPathToWriter_syncCalls: Object.fromEntries(writerUnits.filter((u) => startupReachSync.has(u)).map((u) => [u, startupPath(u)])),
      writersReachableFromStartup_looseAllCalls: writerUnits.filter((u) => startupReachCall.has(u)),
      writersReachableFromLoadTimeCalls_syncCalls: writerUnits.filter((u) => loadReachSync.has(u)),
      writersReachableFromLoadTimeCalls_looseAllCalls: writerUnits.filter((u) => loadReachCall.has(u)),
    };
  }

  // --- persistence deep-dive
  const persistence = {};
  for (const fnName of PERSIST_FUNCS) {
    const g = globals.get(fnName);
    const info = unitInfo.get(fnName);
    const callers = edges.filter((e) => e.to === fnName).map((e) => ({ from: e.from, kind: e.kind, line: e.line, loadTime: e.loadTime }));
    persistence[fnName] = {
      declared: g ? { kind: g.kind, line: g.line, endLine: info?.endLine ?? null } : null,
      callSites: callers.filter((c) => c.kind === 'call').length,
      refSites: callers.filter((c) => c.kind === 'ref').length,
      distinctCallerUnits: [...new Set(callers.map((c) => c.from))].length,
      callerUnits: [...new Set(callers.map((c) => c.from))].sort().slice(0, 60),
      loadTimeCallers: callers.filter((c) => c.loadTime).map((c) => `${c.from}@${c.line}`),
      isInlineHandlerEntry: handlerEntryUnits.includes(fnName),
      reachableFromStartup_syncCalls: startupReachSync.has(fnName),
      reachableFromStartup_looseAllCalls: startupReachCall.has(fnName),
    };
  }
  // ordered call sequence inside a few functions (source order) — facts for the init-order section
  const seqOf = (fnName) => {
    const out = [];
    for (const { s, ast } of parsed) for (const st of ast.body) {
      if (st.type === 'FunctionDeclaration' && st.id.name === fnName) {
        walk(st, [], (n) => { if (n.type === 'CallExpression') out.push({ line: s.tagLine + n.loc.start.line - 1, callee: s.code.slice(n.callee.start, n.callee.end).replace(/\s+/g, ' ').slice(0, 60) }); });
      }
    }
    return out.sort((a, b) => a.line - b.line);
  };
  const sequences = { autoInitApp: seqOf('autoInitApp'), persistState: seqOf('persistState'), resetAllData: seqOf('resetAllData') };

  // --- PERSISTABLE_STATE structure check (keys + closure targets)
  const psInfo = (() => {
    for (const { s, ast } of parsed) for (const st of ast.body) {
      if (st.type === 'VariableDeclaration' && st.declarations[0].id.type === 'Identifier' && st.declarations[0].id.name === 'PERSISTABLE_STATE') {
        const obj = st.declarations[0].init;
        const keys = obj.properties.map((p) => {
          const get = p.value.properties.find((q) => keyName(q.key) === 'get'), set = p.value.properties.find((q) => keyName(q.key) === 'set'), def = p.value.properties.find((q) => keyName(q.key) === 'default');
          const getTarget = get && get.value.body.type === 'Identifier' ? get.value.body.name : null;
          const setTarget = set && set.value.body.type === 'AssignmentExpression' && set.value.body.left.type === 'Identifier' ? set.value.body.left.name : null;
          return { key: keyName(p.key), getTarget, setTarget, defaultSrc: def ? s.code.slice(def.value.body.start, def.value.body.end) : null };
        });
        return { line: s.tagLine + st.loc.start.line - 1, endLine: s.tagLine + st.loc.end.line - 1, kind: st.kind, keys };
      }
    }
    return null;
  })();

  return { scripts, classicIdx: classic.map((s) => s.idx), globals, unitNames, refs, edges, handlers, startup, vars, persistence, sequences, psInfo, unitInfo, loadTimeCallTargets, loadTimeRefTargets, loadReachCall, startupReachCall, startupReachSync, loadReachSync, startupReachAny, handlerEntryUnits };
}

// ------------------------------------------------------------------ run
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail ?? null }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// ---- integrity (before)
const PROD_GLOB = ['frontend/neural_nexus_ai_agents-4-3-5-3.html', 'frontend/main.js', 'frontend/modules/security.mjs', 'frontend/modules/storage.mjs', 'frontend/modules/utilities.mjs', 'frontend/modules/settings.mjs'];
const hashesBefore = Object.fromEntries(PROD_GLOB.map((p) => [p, sha(path.join(ROOT, p))]));
const gitStatus = () => execSync('git status --porcelain -- frontend src-baseline e2e ADR', { cwd: ROOT, encoding: 'utf8' }).trim();
const statusBefore = gitStatus();
const headCommit = execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();

// ---- self-test on synthetic code with known answers (proves the analyzer can discriminate)
{
  const code = `
let a = [], b = 1, c = 2;
function w1(){ a = []; }                 // rebind a
function w2(){ a.push(1); }              // mutate a (method:push)
function w3(){ a[0] = 5; }               // mutate a (member-assign)
function w4(){ let a = 9; a = 10; }      // SHADOWED local: must NOT count
function w5(a){ a = 3; }                 // shadowed param: must NOT count
function w6(){ ({ b } = { b: 2 }); }     // rebind b via destructuring assignment
function w7(){ b++; }                    // rebind b via update
function w8(){ const x = a; return x; }  // escape(alias) a
function w9(){ return a.length + c; }    // read a (member), read c
function w10(){ a.items.push(1); }       // mutate a nested
const o = { m(){ c = 7; } };             // rebind c inside method o.m
(function(){ b = 4; })();                // IIFE at load time: rebind b, loadTime true
function w11(){ f(a); }                  // escape(arg) a
function f(){}
window.w1(); w2();
`;
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', locations: true });
  const r = analyzeProgram(ast, { code, tagLine: 1, idx: 0 }, new Set(['a', 'b', 'c']), new Set(['w1','w2','w3','w4','w5','w6','w7','w8','w9','w10','w11','f','o','a','b','c']));
  const k = (n, kind, detail) => r.refs.filter((x) => x.name === n && x.kind === kind && (detail ? x.detail === detail : true)).length;
  check('self-test: rebind(a) counts only w1 (shadowed w4/w5 excluded)', k('a', 'rebind') === 1, `got ${k('a', 'rebind')}`);
  check('self-test: mutate(a) = push + member-assign + nested push = 3', k('a', 'mutate') === 3 && r.refs.filter((x) => x.name === 'a' && x.kind === 'mutate' && x.nested).length === 1, `got ${k('a', 'mutate')}`);
  check('self-test: rebind(b) = destructuring + update + IIFE = 3; IIFE is loadTime', k('b', 'rebind') === 3 && r.refs.filter((x) => x.name === 'b' && x.kind === 'rebind' && x.loadTime).length === 1);
  check('self-test: rebind(c) via object method labelled o.m', r.refs.some((x) => x.name === 'c' && x.kind === 'rebind' && x.fn === 'o.m'));
  check('self-test: escape(a) = alias + arg', k('a', 'escape', 'alias') === 1 && k('a', 'escape', 'arg') === 1);
  check('self-test: member read of a.length classified read', r.refs.some((x) => x.name === 'a' && x.kind === 'read' && x.detail === 'member-read'));
  {
    // handler var-ref detection: string literal must NOT count, a real reference must (synthetic HTML, in-memory only)
    const synthHtml = '<html><body><button onclick="openWorkspace(\'projects\');">x</button><button onclick="projects.length">y</button><script>function openWorkspace(){}</script></body></html>';
    const hr = analyzeHtml(synthHtml, 'export {};').handlers;
    const lit = hr.find((h) => h.code.startsWith('openWorkspace'));
    const real = hr.find((h) => h.code.startsWith('projects.length'));
    check('self-test: handler var-ref ignores string literal argument, detects a real reference', lit && real && lit.varRefs.length === 0 && real.varRefs.join() === 'projects', `literal=[${lit && lit.varRefs}] real=[${real && real.varRefs}]`);
  }
  check('self-test: window.w1() and w2() recorded as load-time call edges', r.edges.filter((e) => e.loadTime && e.kind === 'call').map((e) => e.to).sort().join() === 'w1,w2');
}

// ---- real analysis
const htmlText = fs.readFileSync(HTML, 'utf8');
const mainText = fs.readFileSync(MAINJS, 'utf8');
const A = analyzeHtml(htmlText, mainText);

check('3 <script> elements found; 2 inline classic + 1 external module', A.scripts.length === 3 && A.scripts.filter((s) => s.src).length === 1 && A.classicIdx.length === 2, A.scripts.map((s) => `${s.type}${s.src ? '(src)' : ''}@${s.tagLine}`).join(' '));
check('both inline classic scripts parsed by acorn without error', A.classicIdx.length === 2);
check('all 16 variables declared exactly once at top level as `let`, column 0 (variables owned by modules/state.mjs excepted — see the slice 10 check)', TARGETS.filter((v) => !S10_OWNED.has(v)).every((v) => A.vars[v].declaration && A.vars[v].declaration.kind === 'let' && A.vars[v].declaration.col0 && A.vars[v].declaration.declaredOnce), TARGETS.filter((v) => !S10_OWNED.has(v) && !(A.vars[v].declaration && A.vars[v].declaration.kind === 'let')).join(','));
check('slice 10: every S10_OWNED variable has NO classic top-level declaration, and main.js imports state.mjs and installs the accessors before the first startup call', [...S10_OWNED].every((v) => !A.vars[v].declaration) && /import \{ installGlobalStateAccessors \} from '\.\/modules\/state\.mjs';/.test(mainText) && mainText.indexOf('installGlobalStateAccessors(window);') > 0 && mainText.indexOf('installGlobalStateAccessors(window);') < mainText.indexOf('window.applyTheme();'), [...S10_OWNED].filter((v) => A.vars[v].declaration).join(','));
check('PERSISTABLE_STATE is a top-level const with exactly 16 keys equal to the 16 names', A.psInfo && A.psInfo.kind === 'const' && A.psInfo.keys.length === 16 && TARGETS.every((v) => A.psInfo.keys.some((k) => k.key === v)));
check('every PERSISTABLE_STATE entry: get/set closures target the SAME-named variable', A.psInfo.keys.every((k) => k.getTarget === k.key && k.setTarget === k.key), A.psInfo.keys.filter((k) => !(k.getTarget === k.key && k.setTarget === k.key)).map((k) => k.key).join(','));
check('every variable has exactly one setter-closure rebind (the PERSISTABLE_STATE entry)', TARGETS.every((v) => A.vars[v].counts.rebindViaPersistableStateSetter === 1));
// NOTE (honest record): the first draft of this script ASSERTED "all 16 are declared before PERSISTABLE_STATE".
// The evidence REFUTED that (see declaredAfterPersistableState in the results). The assertion was therefore
// replaced by a recorded FACT plus a TDZ-safety fact; it was not weakened to make the run pass.
const declaredAfterPS = TARGETS.filter((v) => A.vars[v].declaration && A.vars[v].declaration.beforePersistableState === false);
check('declaration position relative to PERSISTABLE_STATE recorded for all 16 (facts, not a pass/fail on order)', TARGETS.filter((v) => !S10_OWNED.has(v)).every((v) => typeof A.vars[v].declaration.beforePersistableState === 'boolean'), `declared AFTER it: ${declaredAfterPS.join(',') || 'none'}`);
check('TDZ safety: no load-time code (outside functions) and no load-time call closure touches any of the 16', TARGETS.every((v) => A.vars[v].counts.loadTimeSites === 0 && A.vars[v].writersReachableFromLoadTimeCalls_looseAllCalls.length === 0), TARGETS.filter((v) => A.vars[v].counts.loadTimeSites || A.vars[v].writersReachableFromLoadTimeCalls_looseAllCalls.length).join(','));
check('main.js startup sequence parsed (5 window.* calls) and all resolve to monolith functions', A.startup.length === 5 && A.startup.every((s) => A.globals.has(s.name)), A.startup.map((s) => s.name).join(','));
check('persistence functions all found as top-level functions/const', PERSIST_FUNCS.every((f) => A.persistence[f].declared), PERSIST_FUNCS.filter((f) => !A.persistence[f].declared).join(','));

// ---- sensitivity control on the REAL monolith (in memory only; never written)
{
  const needle = 'function snapshotPersistableState(){';
  const idxN = htmlText.indexOf(needle);
  const injected = htmlText.slice(0, idxN) + 'function __probeWriter(){ selectedAgentIds = []; }\n' + htmlText.slice(idxN);
  const B = analyzeHtml(injected, mainText);
  const before = A.vars.selectedAgentIds.counts.rebindSitesOutsideSetter, after = B.vars.selectedAgentIds.counts.rebindSitesOutsideSetter;
  check('sensitivity control (in-memory injection of 1 writer): selectedAgentIds rebind count +1 and the new writer unit is reported', after === before + 1 && B.vars.selectedAgentIds.writerUnits.includes('__probeWriter') && !A.vars.selectedAgentIds.writerUnits.includes('__probeWriter'), `${before} -> ${after}`);
  const inj2 = htmlText.slice(0, idxN) + 'function selectedAgentIds_shadow(){ let selectedAgentIds = 1; selectedAgentIds = 2; }\n' + htmlText.slice(idxN);
  const C = analyzeHtml(inj2, mainText);
  check('negative control (in-memory shadowing local of the same name): count unchanged', C.vars.selectedAgentIds.counts.rebindSitesOutsideSetter === before);
}

// ---- integrity (after)
const hashesAfter = Object.fromEntries(PROD_GLOB.map((p) => [p, sha(path.join(ROOT, p))]));
const statusAfter = gitStatus();
check('integrity: sha256 of 6 production frontend files identical before/after', PROD_GLOB.every((p) => hashesBefore[p] === hashesAfter[p]));
check('integrity: `git status --porcelain` of production paths empty before and after', statusBefore === '' && statusAfter === '', `before="${statusBefore}" after="${statusAfter}"`);

// ---- results JSON (deterministic)
const out = {
  meta: { head: headCommit, acornVersion: acorn.version, htmlFile: HTML_REL, htmlLines: htmlText.split('\n').length, readOnly: true,
    limits: [
      'STATIC analysis only: no code was executed; branch feasibility is not evaluated (reachability is an over-approximation).',
      'Identifier resolution is by bare name with lexical shadowing; dynamic access (window[...], eval, new Function, string-built code) is not resolved.',
      'In-place mutation detection is syntactic (member assignment/update/delete and known mutator method names rooted at the variable); mutation through an alias is NOT detected — see escapeSites.',
      'Inline-handler detection reads on*= attributes in the HTML and inside string/template literals; handlers built any other way are not seen.',
      'unitCallsPersistState = the top-level unit contains a direct bare call to persistState(); persistence reached only transitively or after an await in another unit is not counted.'
    ] },
  scripts: A.scripts.map(({ idx, attrs, src, type, tagLine, nLines }) => ({ idx, attrs, src, type, tagLine, nLines })),
  startupFromMainJs: A.startup,
  persistableState: A.psInfo,
  declaredAfterPersistableState: TARGETS.filter((v) => A.vars[v].declaration && A.vars[v].declaration.beforePersistableState === false),
  declaredBeforePersistableState: TARGETS.filter((v) => A.vars[v].declaration && A.vars[v].declaration.beforePersistableState === true),
  variables: A.vars,
  persistence: A.persistence,
  callSequences: A.sequences,
  handlers: { total: A.handlers.length, html: A.handlers.filter((h) => h.src === 'html').length, jsString: A.handlers.filter((h) => h.src === 'js-string').length, entryUnits: A.handlerEntryUnits.length, directVarRefs: A.handlers.filter((h) => h.varRefs.length).map((h) => ({ src: h.src, event: h.event, line: h.line, vars: h.varRefs, code: h.code.slice(0, 120) })) },
  loadTime: { callTargets: A.loadTimeCallTargets.sort(), refTargets: A.loadTimeRefTargets.sort(), startupRoots: A.startup.map((s) => s.name), startupReachableUnits_looseAllCalls: A.startupReachCall.size, startupReachableUnits_syncCalls: A.startupReachSync.size, loadReachableUnits_looseAllCalls: A.loadReachCall.size, loadReachableUnits_syncCalls: A.loadReachSync.size },
  integrity: { hashesBefore, hashesAfter, statusBefore, statusAfter },
  acceptance: { total: checks.length, passed: checks.filter((c) => c.ok).length, checks },
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2) + '\n');

// ---- human-readable summary on stdout
console.log('\n=== SUMMARY (static; see results JSON for every site) ===');
console.log('var'.padEnd(20) + 'decl'.padEnd(10) + 'rebind(sites/units)'.padEnd(21) + 'mutate'.padEnd(8) + 'read'.padEnd(6) + 'escape'.padEnd(8) + 'loadTime'.padEnd(10) + 'handlerDirect'.padEnd(15) + 'handlerReach(sync)' );
for (const v of TARGETS) {
  const x = A.vars[v], c = x.counts;
  console.log(v.padEnd(20) + (x.declaration ? `${x.declaration.kind}@${x.declaration.line}` : 'state.mjs').padEnd(10) + `${c.rebindSitesOutsideSetter}/${c.rebindUnits}`.padEnd(21) + String(c.mutateSites).padEnd(8) + String(c.readSites).padEnd(6) + String(c.escapeSites).padEnd(8) + String(c.loadTimeSites).padEnd(10) + String(x.inlineHandlerDirectRefs.length).padEnd(15) + x.inlineHandlerEntryUnitsReachingAWriter_syncCalls.length);
}
console.log(`\nACCEPTANCE: ${out.acceptance.passed}/${out.acceptance.total}`);
process.exit(out.acceptance.passed === out.acceptance.total ? 0 : 1);
