/* ==========================================================================
   phase2-core-slice2-adr003-probe.mjs — Phase 2, boundary 5 "core", slice 2.
   EVIDENCE-ONLY. No production code is touched by this script.

   Question: in real Chromium, can ES-module code read and write a classic
   script's top-level let / const / var BY BARE NAME?  (ADR-003 asserts a
   module "cannot close over a let declared in a different script's scope";
   a V8 vm.SourceTextModule probe suggested otherwise. This is the browser-level
   evidence the earlier slice said was required.)

   Part A  SYNTHETIC probe, served from a scratch temp dir (fixtures live in
           phase2-core-slice2-fixtures/). Separate results for module
           read/write against classic let, const, var; window.<name> presence;
           const-write -> TypeError; undeclared-name negative controls ->
           ReferenceError.
   Part B  CONTROL: two ES modules only (module B reads module A's names).
           Shows the probe can tell "shared global scope" from "private scope".
   Part C  STRICTLY READ-ONLY check against the REAL monolith HTML. A module
           is injected into the live page; it only READS (declared? typeof?
           `in window`?). Zero assignments, zero function calls. Frontend
           files are SHA-256-hashed before/after and `git status` is checked.
           Purpose: confirm Part A's behavior applies to the real integration
           context. It is NOT used to justify any architectural change.

   Exit code 0 only if every ACCEPTANCE check passes. Observations about
   whether module read/write WORKS are reported as FINDINGS, not pass/fail:
   the probe must not be rigged toward an answer.
   ========================================================================== */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir, mkdtemp, cp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const FIXTURES = path.join(HERE, 'phase2-core-slice2-fixtures');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/opt/pw-browsers')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}
const { chromium } = createRequire(path.join(ROOT, 'e2e', 'package.json'))('playwright');

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
async function serve(dir) {
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') { res.writeHead(405); return res.end('read-only'); }
      const rel = decodeURIComponent((req.url || '/').split('?')[0]);
      const file = path.resolve(dir, '.' + (rel === '/' ? '/' + HTML_FILE : rel));
      if (!file.startsWith(path.resolve(dir) + path.sep)) { res.writeHead(403); return res.end('forbidden'); }
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: server.address().port };
}

async function hashTree(dir, base = dir, acc = {}) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === 'coverage') continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await hashTree(p, base, acc);
    else acc[path.relative(base, p)] = createHash('sha256').update(await readFile(p)).digest('hex');
  }
  return acc;
}

// Open a page, collect every console line + page error, resolve when a console
// line starting with `marker` arrives (or time out and say so).
async function runPage(browser, url, marker, { beforeWait } = {}) {
  const page = await browser.newPage();
  const consoleLines = [];
  const pageErrors = [];
  let resolveResult;
  const resultP = new Promise((r) => { resolveResult = r; });
  page.on('console', (m) => {
    const t = m.text();
    consoleLines.push({ type: m.type(), text: t.length > 400 ? t.slice(0, 400) + '…[truncated in log only]' : t });
    if (t.startsWith(marker)) resolveResult(t.slice(marker.length));
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(url, { waitUntil: 'load' });
  if (beforeWait) await beforeWait(page);
  const raw = await Promise.race([resultP, new Promise((r) => setTimeout(() => r(null), 20000))]);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = null; }
  return { page, raw, parsed, consoleLines, pageErrors };
}

const report = { startedAt: new Date().toISOString() };
let browser;
const servers = [];
try {
  browser = await chromium.launch();
  const version = browser.version();
  const probePage = await browser.newPage();
  const userAgent = await probePage.evaluate(() => navigator.userAgent);
  await probePage.close();
  report.chromium = { version, userAgent, playwrightBrowsersPath: process.env.PLAYWRIGHT_BROWSERS_PATH || null };
  check('S0-chromium-version-recorded', /^\d+\.\d+/.test(version), `Chromium ${version}`);

  // ------------------------------------------------------------------ Part A
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'nexus-slice2-probe-'));
  await cp(FIXTURES, scratch, { recursive: true });
  const scratchSrv = await serve(scratch); servers.push(scratchSrv.server);
  report.scratchDir = scratch;

  const A = await runPage(browser, `http://127.0.0.1:${scratchSrv.port}/classic-then-module.html`, 'PROBE_RESULT:');
  await A.page.close();
  report.partA = { raw: A.raw, parsed: A.parsed, console: A.consoleLines, pageErrors: A.pageErrors };
  const a = A.parsed;
  check('A0-synthetic-probe-produced-result', !!a && A.pageErrors.length === 0, `pageErrors=${A.pageErrors.length}`);
  if (a) {
    check('A1-harness-ran-as-ES-module', a.context.importMetaUrlType === 'string' && a.context.topLevelThis === 'undefined' && a.context.strictMode === true, JSON.stringify(a.context));
    check('A2-harness-order-classic-before-module',
      JSON.stringify(a.order.atModuleStart) === JSON.stringify(['classic-start', 'classic-end']),
      `atModuleStart=${JSON.stringify(a.order.atModuleStart)}`);
    const required = ['read_let', 'read_const', 'read_var', 'write_let', 'write_var', 'write_const', 'control_undeclared_read', 'control_undeclared_write', 'control_undeclared_typeof'];
    const missing = required.filter((k) => !(k in a));
    check('A3-all-required-cases-recorded', missing.length === 0, missing.length ? `missing=${missing}` : `cases=${required.length}`);
    check('A4-const-write-throws-TypeError', a.write_const.threw === true && a.write_const.errorName === 'TypeError', JSON.stringify(a.write_const));
    check('A5-undeclared-read-throws-ReferenceError', a.control_undeclared_read.threw === true && a.control_undeclared_read.errorName === 'ReferenceError', JSON.stringify(a.control_undeclared_read));
    check('A6-undeclared-write-throws-ReferenceError', a.control_undeclared_write.threw === true && a.control_undeclared_write.errorName === 'ReferenceError', JSON.stringify(a.control_undeclared_write));
    check('A7-undeclared-typeof-is-undefined-no-throw', a.control_undeclared_typeof.threw === false && a.control_undeclared_typeof.value === 'undefined', JSON.stringify(a.control_undeclared_typeof));
  }

  // ------------------------------------------------------------------ Part B
  const B = await runPage(browser, `http://127.0.0.1:${scratchSrv.port}/control-modules.html`, 'PROBE_RESULT:');
  await B.page.close();
  report.partB = { raw: B.raw, parsed: B.parsed, console: B.consoleLines, pageErrors: B.pageErrors };
  const b = B.parsed;
  check('B0-control-produced-result', !!b, '');
  if (b) {
    for (const k of ['read_A_LET', 'read_A_CONST', 'read_A_VAR']) {
      check(`B-control-${k}-ReferenceError`, b[k].threw === true && b[k].errorName === 'ReferenceError', JSON.stringify(b[k]));
    }
  }

  // ------------------------------------------------------------------ Part C
  const before = await hashTree(FRONTEND);
  const real = await serve(FRONTEND); servers.push(real.server);

  // Static facts about the real layout (read-only).
  const html = await readFile(path.join(FRONTEND, HTML_FILE), 'utf8');
  const modTag = html.indexOf('<script type="module" src="main.js"></script>');
  const classicStart = html.indexOf('<script>', modTag);
  const classicEnd = html.indexOf('</script>', classicStart);
  const classicSrc = html.slice(classicStart + '<script>'.length, classicEnd);
  check('C0-real-layout-module-tag-precedes-main-classic-script', modTag >= 0 && classicStart > modTag && classicEnd > classicStart, `moduleTag@${modTag} classicScript@${classicStart}-${classicEnd}`);

  const declRe = /^(let|const|var)\s+([A-Za-z_$][\w$]*)/gm;
  const fnRe = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;
  const decls = { let: [], const: [], var: [] };
  for (const m of classicSrc.matchAll(declRe)) decls[m[1]].push(m[2]);
  const fns = [...classicSrc.matchAll(fnRe)].map((m) => m[1]);
  for (const k of Object.keys(decls)) decls[k] = [...new Set(decls[k])];
  const fnNames = [...new Set(fns)];
  report.partC = { declCounts: { let: decls.let.length, const: decls.const.length, var: decls.var.length, function: fnNames.length },
                   note: 'names are column-0 declarations inside the main classic <script>; `let a=1,b=2` second declarators are not enumerated' };

  // Generated READ-ONLY module: only bare-name reads, typeof, and `in window`.
  const lines = [];
  lines.push(`const __NX_R = { context: { importMetaUrlType: typeof import.meta.url, strictMode: (function(){ return this === undefined; })() }, let: [], const: [], var: [], func: [], detail: {} };`);
  lines.push(`function __nx_p(group, name, f) { let t; try { t = f(); } catch (e) { t = 'ERR:' + e.name; } __NX_R[group].push([name, t, name in window]); }`);
  for (const n of decls.let) lines.push(`__nx_p('let', ${JSON.stringify(n)}, () => { ${n}; return 'declared:' + typeof ${n}; });`);
  for (const n of decls.const) lines.push(`__nx_p('const', ${JSON.stringify(n)}, () => { ${n}; return 'declared:' + typeof ${n}; });`);
  for (const n of decls.var) lines.push(`__nx_p('var', ${JSON.stringify(n)}, () => { ${n}; return 'declared:' + typeof ${n}; });`);
  for (const n of fnNames) lines.push(`__nx_p('func', ${JSON.stringify(n)}, () => { ${n}; return 'declared:' + typeof ${n}; });`);
  lines.push(`const __nx_d = (k, f) => { try { __NX_R.detail[k] = f(); } catch (e) { __NX_R.detail[k] = 'ERR:' + e.name; } };`);
  lines.push(`__nx_d('messages_isArray', () => Array.isArray(messages)); __nx_d('messages_length', () => messages.length);`);
  lines.push(`__nx_d('encryptionKey_typeof', () => typeof encryptionKey); __nx_d('selectedAgentIds_json', () => JSON.stringify(selectedAgentIds));`);
  lines.push(`__nx_d('customAgents_isArray', () => Array.isArray(customAgents)); __nx_d('STORAGE_KEY', () => STORAGE_KEY); __nx_d('MESSAGE_CAP', () => MESSAGE_CAP);`);
  lines.push(`__nx_d('PERSISTABLE_STATE_typeof', () => typeof PERSISTABLE_STATE); __nx_d('PERSISTABLE_STATE_keyCount', () => Object.keys(PERSISTABLE_STATE).length);`);
  lines.push(`console.log('REAL_PROBE_RESULT:' + JSON.stringify(__NX_R));`);
  const realModuleSrc = lines.join('\n');
  await writeFile(path.join(HERE, 'phase2-core-slice2-real-readonly-probe.generated.mjs'), realModuleSrc);

  const initPage = await browser.newPage();
  const realConsole = [];
  const realPageErrors = [];
  initPage.on('console', (m) => { const t = m.text(); realConsole.push({ type: m.type(), text: t.startsWith('REAL_PROBE_RESULT:') ? `REAL_PROBE_RESULT:<${t.length} chars, parsed separately>` : t.slice(0, 300) }); });
  initPage.on('pageerror', (e) => realPageErrors.push(String(e)));
  let resolveReal; const realP = new Promise((r) => { resolveReal = r; });
  initPage.on('console', (m) => { const t = m.text(); if (t.startsWith('REAL_PROBE_RESULT:')) resolveReal(t.slice('REAL_PROBE_RESULT:'.length)); });
  await initPage.goto(`http://127.0.0.1:${real.port}/`, { waitUntil: 'networkidle' });
  await initPage.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
  check('C1-real-page-loaded-and-initialized', realPageErrors.length === 0, `pageErrors=${realPageErrors.length}`);

  const fingerprint = () => initPage.evaluate(() => ({ messagesLength: messages.length, selectedAgentIds: JSON.stringify(selectedAgentIds), customAgentsLength: customAgents.length, STORAGE_KEY, MESSAGE_CAP }));
  const fpBefore = await fingerprint();

  await initPage.addScriptTag({ type: 'module', content: realModuleSrc });
  const rawReal = await Promise.race([realP, new Promise((r) => setTimeout(() => r(null), 20000))]);
  let R = null; try { R = rawReal ? JSON.parse(rawReal) : null; } catch (e) { R = null; }

  // Same names, classic GLOBAL scope (indirect eval), for a consistency comparison.
  const globalSide = await initPage.evaluate((groups) => {
    const probe = (n) => { try { return (0, eval)('try{' + n + ';"declared:"+typeof ' + n + '}catch(e){"ERR:"+e.name}'); } catch (e) { return 'EVALERR:' + e.name; } };
    const o = {}; for (const [g, names] of Object.entries(groups)) o[g] = names.map((n) => [n, probe(n)]); return o;
  }, { let: decls.let, const: decls.const, var: decls.var, func: fnNames });
  const fpAfter = await fingerprint();
  await initPage.close();

  report.partC.raw = rawReal ? `${rawReal.length} chars` : null;
  report.partC.parsed = R;
  report.partC.globalSide = globalSide;
  report.partC.console = realConsole;
  report.partC.pageErrors = realPageErrors;

  check('C2-real-readonly-probe-produced-result', !!R && R.context.importMetaUrlType === 'string' && R.context.strictMode === true, R ? JSON.stringify(R.context) : 'no result');
  if (R) {
    const summarize = (group) => {
      const rows = R[group];
      const declared = rows.filter((r) => String(r[1]).startsWith('declared:')).length;
      const errs = rows.filter((r) => String(r[1]).startsWith('ERR:')).map((r) => `${r[0]}=${r[1]}`);
      const inWindow = rows.filter((r) => r[2]).length;
      const gmap = new Map(globalSide[group]);
      const mismatches = rows.filter((r) => gmap.get(r[0]) !== r[1]).map((r) => `${r[0]}: module=${r[1]} global=${gmap.get(r[0])}`);
      return { total: rows.length, moduleReadable: declared, moduleErrors: errs, onWindow: inWindow, moduleVsGlobalMismatches: mismatches };
    };
    const sum = { let: summarize('let'), const: summarize('const'), var: summarize('var'), func: summarize('func') };
    report.partC.summary = sum;
    check('C3-real-names-all-observed', sum.let.total === decls.let.length && sum.const.total === decls.const.length && sum.func.total === fnNames.length && decls.let.length > 0 && decls.const.length > 0, `let=${sum.let.total} const=${sum.const.total} var=${sum.var.total} function=${sum.func.total}`);
    check('C4-module-vs-classic-global-comparison-executed', ['let', 'const', 'var', 'func'].every((g) => R[g].length === globalSide[g].length), `mismatches: let=${sum.let.moduleVsGlobalMismatches.length} const=${sum.const.moduleVsGlobalMismatches.length} func=${sum.func.moduleVsGlobalMismatches.length}`);
  }

  const after = await hashTree(FRONTEND);
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  let gitPorcelain = '';
  try { gitPorcelain = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', 'frontend', 'src-baseline', 'ADR', 'e2e'], { encoding: 'utf8' }).trim(); } catch (e) { gitPorcelain = 'GIT-ERROR:' + e.message; }
  const fpSame = JSON.stringify(fpBefore) === JSON.stringify(fpAfter);
  report.partC.integrity = { filesHashed: Object.keys(before).length, changedFiles: changed, gitPorcelainProduction: gitPorcelain, appStateFingerprintBefore: fpBefore, appStateFingerprintAfter: fpAfter };
  check('C5-real-check-was-read-only', changed.length === 0 && gitPorcelain === '' && fpSame, `files=${Object.keys(before).length} changed=${changed.length} gitProductionDiff=${gitPorcelain === '' ? 'none' : 'PRESENT'} appStateUnchanged=${fpSame}`);

  // -------------------------------------------------------------- Findings
  const findings = {};
  if (a) {
    findings.syntheticModuleToClassic = {
      readLet: a.read_let, readConst: a.read_const, readVar: a.read_var,
      writeLet: { result: a.write_let, seen: a.write_let_seen },
      writeVar: { result: a.write_var, seen: a.write_var_seen },
      writeConst: { result: a.write_const, seen: a.write_const_seen },
      writeArrayReassign: { result: a.write_arr_reassign, seen: a.write_arr_seen },
      writeConstObjectProperty: { result: a.write_const_object_property, seen: a.write_obj_seen },
      classicWriteThenModuleRead: a.read_let_after_classic_write,
      windowPresence: { let: a.window.CL_LET, const: a.window.CL_CONST, var: a.window.CL_VAR },
      reverseIsolation_classicSeesModuleNames: a.reverse_isolation,
    };
  }
  if (b) findings.controlModuleToModule = { readA_LET: b.read_A_LET, readA_CONST: b.read_A_CONST, readA_VAR: b.read_A_VAR };
  if (R && report.partC.summary) findings.realMonolithReadOnly = { counts: report.partC.declCounts, summary: report.partC.summary, detail: R.detail };
  report.findings = findings;
} catch (e) {
  check('RUNNER-no-unexpected-exception', false, String(e && e.stack || e));
} finally {
  for (const s of servers) s.close();
  if (browser) await browser.close();
}

report.finishedAt = new Date().toISOString();
report.checks = checks;
const failed = checks.filter((c) => !c.ok);
report.acceptance = { total: checks.length, passed: checks.length - failed.length, failed: failed.map((c) => c.name) };
await writeFile(path.join(HERE, 'phase2-core-slice2-adr003-probe-results.json'), JSON.stringify(report, null, 2));
console.log('\n=== FINDINGS (observations, not pass/fail) ===');
console.log(JSON.stringify(report.findings, null, 2));
console.log(`\n=== ACCEPTANCE SUMMARY ===\n${report.acceptance.passed}/${report.acceptance.total} checks passed${failed.length ? '  FAILED: ' + failed.map((c) => c.name).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
