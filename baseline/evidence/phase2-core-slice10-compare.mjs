// Core slice 10 — PRE vs POST fingerprint comparison (AC-4) + production footprint (AC-7). Read-only.
// Usage: node baseline/evidence/phase2-core-slice10-compare.mjs <pre-results.json> <post-results.json>
// Inputs are the `NEXUS_S10_RESULTS` outputs of e2e/phase2-core-slice10-flows.mjs run on the unmodified tree (PRE) and the patched tree (POST).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [preP, postP] = process.argv.slice(2);
if (!preP || !postP) { console.error('usage: <pre.json> <post.json>'); process.exit(2); }
const pre = JSON.parse(fs.readFileSync(preP, 'utf8')), post = JSON.parse(fs.readFileSync(postP, 'utf8'));
const checks = [];
const rec = (name, ok, detail) => { checks.push({ name, ok }); console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' — ' + detail : ''}`); };
const diff = (a, b) => { const B = new Set(b); return a.filter((x) => !B.has(x)); };

const plus = diff(post.fingerprint.windowOwnProps, pre.fingerprint.windowOwnProps);
const minus = diff(pre.fingerprint.windowOwnProps, post.fingerprint.windowOwnProps);
rec('window own-property names POST − PRE = exactly {agentOrder}', JSON.stringify(plus) === '["agentOrder"]', JSON.stringify(plus));
rec('window own-property names PRE − POST = {}', minus.length === 0, JSON.stringify(minus));

const bp = diff(post.fingerprint.bootScriptRequests, pre.fingerprint.bootScriptRequests);
const bm = diff(pre.fingerprint.bootScriptRequests, post.fingerprint.bootScriptRequests);
rec('boot-time module requests POST − PRE = exactly {/modules/state.mjs}', JSON.stringify(bp) === '["/modules/state.mjs"]', JSON.stringify(bp));
rec('boot-time module requests PRE − POST = {}', bm.length === 0, JSON.stringify(bm));

rec('app-state fingerprint (sha256 of the persisted state after the fixed scenario) identical', pre.fingerprint.stateSha256 === post.fingerprint.stateSha256, `${pre.fingerprint.stateSha256.slice(0, 16)}… vs ${post.fingerprint.stateSha256.slice(0, 16)}…`);

const prePres = pre.checks.filter((c) => c.kind === 'PRES').map((c) => `${c.name}=${c.ok}`);
const postPres = post.checks.filter((c) => c.kind === 'PRES').map((c) => `${c.name}=${c.ok}`);
rec('PRES verdicts identical PRE vs POST (same names, all true)', JSON.stringify(prePres) === JSON.stringify(postPres) && prePres.length > 0 && prePres.every((x) => x.endsWith('=true')), `${prePres.length} vs ${postPres.length}`);
const prePS = post.checks.filter((c) => c.kind === 'PS').every((c) => c.ok) && pre.checks.filter((c) => c.kind === 'PS').every((c) => !c.ok);
rec('PS checks: all RED on PRE and all GREEN on POST', prePS, `PRE ${pre.counts.PS}, POST ${post.counts.PS}`);
rec('POST verdict ACCEPTED, PRE verdict REJECTED', post.verdict === 'ACCEPTED' && pre.verdict === 'REJECTED', `${pre.verdict} -> ${post.verdict}`);

// AC-7 footprint (against git HEAD of the repo this script lives in)
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const HTML = 'frontend/neural_nexus_ai_agents-4-3-5-3.html';
const num = git('diff', '--numstat', 'HEAD', '--', HTML).trim().split('\t');
rec('monolith diff <= 2 added / <= 2 deleted lines', +num[0] <= 2 && +num[1] <= 2 && +num[0] + +num[1] > 0, `+${num[0]} -${num[1]}`);
const changed = git('status', '--porcelain', '--', 'frontend', 'src-baseline').split('\n').filter(Boolean).map((l) => l.slice(3)).sort();
const expected = [HTML, 'frontend/main.js', 'frontend/modules/state.mjs', 'frontend/modules/state.test.mjs'].sort();
rec('changed/new files under frontend/ and src-baseline/ are exactly the 4 expected', JSON.stringify(changed) === JSON.stringify(expected), JSON.stringify(changed));
const mainDiff = git('diff', '--numstat', 'HEAD', '--', 'frontend/main.js').trim().split('\t');
rec('main.js diff = 5 added / 0 deleted lines (1 import + 4 install block lines)', mainDiff[0] === '5' && mainDiff[1] === '0', `+${mainDiff[0]} -${mainDiff[1]}`);

const failed = checks.filter((c) => !c.ok).map((c) => c.name);
console.log(`\nCOMPARE: ${checks.length - failed.length}/${checks.length}${failed.length ? '  FAILED: ' + failed.join(' | ') : ''}`);
process.exit(failed.length ? 1 : 0);
