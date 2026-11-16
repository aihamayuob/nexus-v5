/* ==========================================================================
   e2e/phase2-evidence-integrity-flows.mjs — Evidence Integrity guard (CP-16, ADR-004): UI acceptance tests of the
   Ops Center claim form. Criteria written first: baseline/evidence/phase2-evidence-integrity-acceptance-criteria.md (AC-U1…U8).

   Real HTML + real modules + real renderOpsEvaluation / opsAddEvidenceRow / opsSubmitClaim / opsFetch / opsRenderClaimRecord
   (no stubs of app logic). The page is served from https://nexus.test via context.route; the "backend" is the fake HTTPS origin
   https://backend.test, also intercepted by Playwright, which RECORDS the real request bodies. Nothing else leaves the machine.

   Check kinds (tag in the name, printed as [KIND])
     VALID  measurement validity / controls — must always be green, else verdict INVALID
     PRES   behavior that must be preserved — green PRE and POST
     PS     patch-specific — RED on the unpatched tree, GREEN after the patch
   Final line:  EI-UI-VERDICT = ACCEPTED | REJECTED | INVALID  (+ per-kind counts). Exit 0 iff ACCEPTED.

   NEXUS_FRONTEND_DIR points the script at scratch copies (mutants); NEXUS_EI_UI_RESULTS overrides the results JSON
   (default baseline/evidence/phase2-evidence-integrity-ui-results.json). Deterministic: no timings/timestamps.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_EI_UI_RESULTS || path.resolve(HERE, '../baseline/evidence/phase2-evidence-integrity-ui-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const BACKEND = 'https://backend.test';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const VALID_KINDS = ['INDEPENDENT_SOURCE', 'TOOL_RESULT', 'EXECUTABLE_VERIFICATION', 'ENVIRONMENTAL_OBSERVATION', 'HUMAN_CONFIRMATION', 'CONTRADICTORY_EVIDENCE'];

const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const pres = (n, ok, d) => rec('PRES', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);
const pageErrors = [];
let browser = null;

async function newScenario() {
  const ctx = await browser.newContext();
  const claimPosts = []; // parsed JSON bodies of every POST /v2/evaluation/claim
  const other = [];      // every other request to the fake backend or anywhere non-origin
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin === ORIGIN) {
      const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
      try {
        const content = await readFile(path.join(FRONTEND_DIR, rel));
        return route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: content });
      } catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    if (u.origin === BACKEND) {
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() === 'POST' && u.pathname === '/v2/evaluation/claim') {
        let body = null; try { body = JSON.parse(req.postData() || 'null'); } catch { /* keep null */ }
        claimPosts.push(body);
        const reason = body && Array.isArray(body.evidence) && body.evidence.some((e) => e && e.kind) ? 'INDEPENDENT_EVIDENCE' : 'CONSENSUS_ONLY';
        return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({
          id: 'fake-1', subjectType: 'manual', subjectId: null, claim: body?.claim ?? '', ran: true, verdict: 'UNVERIFIED', confidence: 1, rationale: 'fake',
          supportingEvidenceCount: 0, conflictingEvidenceCount: 0, evidence: body?.evidence ?? [], integrityReason: reason, createdAt: 1700000000000 }) });
      }
      if (req.method() === 'GET' && u.pathname === '/v2/evaluation/claims') return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ evaluations: [] }) });
      other.push(req.method() + ' ' + u.pathname);
      return route.fulfill({ status: 404, headers: cors, body: '{}' });
    }
    other.push(req.method() + ' ' + u.origin + u.pathname);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(3000);
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  return { ctx, page, claimPosts, other };
}
async function boot(page) {
  await page.goto(ORIGIN + '/', { waitUntil: 'load' });
  try { await page.waitForFunction(() => typeof renderOpsEvaluation === 'function' && typeof opsSubmitClaim === 'function', null, { timeout: 15000 }); } catch { return false; }
  await page.evaluate((b) => { localStorage.setItem('nexus_backend_url', b); }, BACKEND);
  // mount the REAL Ops Center evaluation tab body into a host element
  await page.evaluate(async () => {
    const host = document.createElement('div'); host.id = 'ei-host'; document.body.appendChild(host);
    await renderOpsEvaluation(host);
  });
  try { await page.waitForSelector('#opsEvidenceRowsWrap', { timeout: 5000 }); return true; } catch { return false; }
}
// Fill row i (0-based). kind === undefined leaves the selector untouched.
async function fillRow(page, i, { source, content, kind }) {
  if (source !== undefined) await page.locator('.ops-ev-source').nth(i).fill(source);
  if (content !== undefined) await page.locator('.ops-ev-content').nth(i).fill(content);
  // tolerant on purpose: on the unpatched tree there is no selector; that must show up as a red PS check, not a crash
  if (kind !== undefined) { try { await page.locator('.ops-ev-kind').nth(i).selectOption(kind, { timeout: 1500 }); } catch { /* selector missing */ } }
}
async function clickEvaluate(page) {
  await page.evaluate(() => { opsSubmitClaim(); });
  await page.waitForTimeout(400); // let the (intercepted) request and the DOM update settle
}
const resultText = (page) => page.evaluate(() => document.getElementById('opsClaimResult')?.innerText || '');
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toastContainer .toast')].map((t) => t.textContent));
async function scenario(name, fn) {
  try { return await fn(); } catch (e) { valid(`${name}-scenario-completed-without-crash`, false, String(e && e.message || e).slice(0, 200)); return null; }
}
const out = {};

try {
  browser = await chromium.launch();
  console.log(`Chromium ${browser.version()}; FRONTEND_DIR=${FRONTEND_DIR}`);

  // ============ controls: the harness itself (VALID) ============
  await scenario('C0', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      valid('C0-ops-evaluation-tab-mounts-and-has-one-evidence-row', (await boot(page)) && (await page.locator('.ops-ev-source').count()) === 1 && (await page.locator('.ops-ev-content').count()) === 1);
      await page.fill('#opsClaimText', 'C0 claim');
      await clickEvaluate(page);
      valid('C0-empty-evidence-claim-reaches-the-recorded-backend-origin', claimPosts.length === 1 && claimPosts[0].claim === 'C0 claim', JSON.stringify(claimPosts[0]));
    } finally { await ctx.close(); }
  });

  // ============ AC-U1 / AC-U2: selector per row, no default, exact options ============
  await scenario('U1', async () => {
    const { ctx, page } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U1-boot', false); return; }
      ps('AC-U1-first-row-has-exactly-one-kind-selector', (await page.locator('.ops-ev-kind').count()) === 1);
      ps('AC-U1-first-row-selector-has-no-preselected-kind', (await page.locator('.ops-ev-kind').first().inputValue().catch(() => 'MISSING')) === '');
      await page.evaluate(() => { opsAddEvidenceRow(); opsAddEvidenceRow(); });
      const n = await page.locator('.ops-ev-source').count();
      const kinds = await page.locator('.ops-ev-kind').count();
      ps('AC-U1-every-added-row-also-has-one-selector', n === 3 && kinds === 3, `rows=${n} selectors=${kinds}`);
      const vals = await page.locator('.ops-ev-kind').evaluateAll((els) => els.map((e) => e.value));
      ps('AC-U1-no-row-has-a-preselected-kind', vals.length === 3 && vals.every((v) => v === ''), JSON.stringify(vals));
      const opts = await page.locator('.ops-ev-kind').first().evaluate((el) => [...el.options].map((o) => o.value)).catch(() => []);
      const nonEmpty = opts.filter((v) => v !== '');
      ps('AC-U2-selector-offers-a-placeholder-and-exactly-the-six-valid-kinds',
        opts.filter((v) => v === '').length === 1 && nonEmpty.length === 6 && new Set(nonEmpty).size === 6 && VALID_KINDS.every((k) => nonEmpty.includes(k)), JSON.stringify(opts));
    } finally { await ctx.close(); }
  });

  // ============ AC-U3 / AC-U4: block without an explicit kind ============
  await scenario('U3', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U3-boot', false); return; }
      await page.fill('#opsClaimText', 'U3 claim');
      await fillRow(page, 0, { source: 'https://x.example', content: 'some evidence' });
      await clickEvaluate(page);
      ps('AC-U3-filled-row-without-kind-sends-ZERO-requests', claimPosts.length === 0, `posts=${claimPosts.length}`);
      const tt = await toasts(page);
      ps('AC-U3-a-toast-explains-the-block', tt.length >= 1, JSON.stringify(tt));
      const rt = await resultText(page);
      ps('AC-U3-no-evaluation-record-is-rendered', !/UNVERIFIED|SUPPORTED|VERIFIED|CONSENSUS_ONLY/.test(rt), JSON.stringify(rt.slice(0, 120)));
      // now choose a kind on the same row -> goes through (control that the block is about the kind, not something else)
      const before = claimPosts.length;
      await fillRow(page, 0, { kind: 'INDEPENDENT_SOURCE' });
      await clickEvaluate(page);
      // PRE (no selector, no block) the first click already sent one request; either way this click must add exactly one
      valid('U3-control-clicking-evaluate-again-after-choosing-a-kind-sends-exactly-one-more-request', claimPosts.length === before + 1, `before=${before} after=${claimPosts.length}`);
    } finally { await ctx.close(); }
  });
  await scenario('U4', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U4-boot', false); return; }
      await page.evaluate(() => { opsAddEvidenceRow(); });
      await page.fill('#opsClaimText', 'U4 claim');
      await fillRow(page, 0, { source: 's1', content: 'c1', kind: 'TOOL_RESULT' });
      await fillRow(page, 1, { source: 's2', content: 'c2' });
      await clickEvaluate(page);
      ps('AC-U4-one-row-with-a-kind-plus-one-filled-row-without-sends-ZERO-requests-no-silent-partial-send', claimPosts.length === 0, `posts=${claimPosts.length}`);
    } finally { await ctx.close(); }
  });

  // ============ AC-U5: the chosen kind is what is sent, for each kind ============
  for (const kind of VALID_KINDS) {
    await scenario('U5-' + kind, async () => {
      const { ctx, page, claimPosts } = await newScenario();
      try {
        if (!(await boot(page))) { valid('U5-boot', false); return; }
        await page.fill('#opsClaimText', 'U5 claim');
        await fillRow(page, 0, { source: 'src-' + kind, content: 'content-' + kind, kind });
        await clickEvaluate(page);
        const b = claimPosts[0];
        ps(`AC-U5-${kind}-is-sent-in-the-request-body`, claimPosts.length === 1 && b && b.claim === 'U5 claim' && Array.isArray(b.evidence) && b.evidence.length === 1
          && b.evidence[0].source === 'src-' + kind && b.evidence[0].content === 'content-' + kind && b.evidence[0].kind === kind, JSON.stringify(b));
      } finally { await ctx.close(); }
    });
  }

  // ============ AC-U6: preserved behavior ============
  await scenario('U6a', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U6a-boot', false); return; }
      await clickEvaluate(page);
      const tt = await toasts(page);
      pres('AC-U6-empty-claim-still-toasts-and-sends-nothing', claimPosts.length === 0 && tt.length >= 1, `posts=${claimPosts.length} toasts=${JSON.stringify(tt)}`);
    } finally { await ctx.close(); }
  });
  await scenario('U6b', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U6b-boot', false); return; }
      await page.fill('#opsClaimText', 'U6b claim');
      await page.evaluate(() => { opsAddEvidenceRow(); opsAddEvidenceRow(); });
      await clickEvaluate(page); // three completely empty rows
      pres('AC-U6-fully-empty-rows-are-ignored-and-the-claim-is-sent-with-empty-evidence', claimPosts.length === 1 && Array.isArray(claimPosts[0].evidence) && claimPosts[0].evidence.length === 0, JSON.stringify(claimPosts[0]));
    } finally { await ctx.close(); }
  });
  await scenario('U6c', async () => {
    const { ctx, page, claimPosts } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U6c-boot', false); return; }
      await page.evaluate(() => { opsAddEvidenceRow(); opsAddEvidenceRow(); opsAddEvidenceRow(); });
      await page.fill('#opsClaimText', 'U6c claim');
      await fillRow(page, 0, { source: 'only-source' });                       // source only
      await fillRow(page, 1, { content: 'only-content' });                      // content only
      await fillRow(page, 2, { kind: 'HUMAN_CONFIRMATION' });                   // kind only
      await fillRow(page, 3, { source: 'full-src', content: 'full-content', kind: 'HUMAN_CONFIRMATION' }); // complete
      await clickEvaluate(page);
      const b = claimPosts[0];
      pres('AC-U6-partial-rows-and-a-kind-only-row-are-ignored-only-the-complete-row-is-sent', claimPosts.length === 1 && b.evidence.length === 1 && b.evidence[0].source === 'full-src', JSON.stringify(b));
    } finally { await ctx.close(); }
  });

  // ============ AC-U7: reason shown (pure render, real function) ============
  await scenario('U7', async () => {
    const { ctx, page } = await newScenario();
    try {
      if (!(await boot(page))) { valid('U7-boot', false); return; }
      const base = { id: 'x', claim: 'ادعاء للعرض', verdict: 'UNVERIFIED', confidence: 1, rationale: 'مبرر', supportingEvidenceCount: 0, conflictingEvidenceCount: 0, createdAt: 1700000000000 };
      const withReason = await page.evaluate((r) => opsRenderClaimRecord(r), { ...base, integrityReason: 'CONSENSUS_ONLY' });
      const legacy = await page.evaluate((r) => opsRenderClaimRecord(r), { ...base, integrityReason: null });
      const noField = await page.evaluate((r) => opsRenderClaimRecord(r), base);
      ps('AC-U7-the-reason-is-shown-when-present', withReason.includes('CONSENSUS_ONLY'));
      pres('AC-U7-no-reason-text-for-a-legacy-record-null', !/CONSENSUS_ONLY|INDEPENDENT_EVIDENCE|CONTRADICTORY_EVIDENCE|NO_EVIDENCE|EXECUTABLE_VERIFICATION/.test(legacy) && legacy.includes('ادعاء للعرض'));
      pres('AC-U7-no-reason-text-for-a-record-without-the-field', !/CONSENSUS_ONLY|INDEPENDENT_EVIDENCE|CONTRADICTORY_EVIDENCE|NO_EVIDENCE|EXECUTABLE_VERIFICATION/.test(noField) && noField.includes('ادعاء للعرض'));
      const xss = await page.evaluate((r) => opsRenderClaimRecord(r), { ...base, integrityReason: '<img src=x onerror=alert(1)>' });
      pres('AC-U7-the-reason-is-HTML-escaped', !xss.includes('<img src=x'), xss.slice(0, 160));
    } finally { await ctx.close(); }
  });

  // ============ AC-U8 ============
  valid('AC-U8-no-uncaught-page-errors-in-any-scenario', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  valid('script-ran-to-completion', false, String(e && e.stack || e).slice(0, 400));
} finally {
  if (browser) await browser.close();
}

const by = (k) => checks.filter((c) => c.kind === k);
const cnt = (k) => `${by(k).filter((c) => c.ok).length}/${by(k).length}`;
const allValid = by('VALID').every((c) => c.ok) && by('VALID').length > 0;
const allPres = by('PRES').every((c) => c.ok);
const allPs = by('PS').every((c) => c.ok);
const verdict = !allValid ? 'INVALID' : (allPres && allPs ? 'ACCEPTED' : 'REJECTED');
const passed = checks.filter((c) => c.ok).length;
console.log(`\n=== SUMMARY ===\n${passed}/${checks.length} checks passed  (VALID ${cnt('VALID')}, PRES ${cnt('PRES')}, PS ${cnt('PS')})`);
console.log(`EI-UI-VERDICT = ${verdict}  (frontend=${path.relative(process.cwd(), FRONTEND_DIR) || '.'})`);
out.verdict = verdict; out.counts = { valid: cnt('VALID'), pres: cnt('PRES'), ps: cnt('PS') };
out.checks = checks.map(({ kind, name, ok }) => ({ kind, name, ok }));
await writeFile(RESULTS_FILE, JSON.stringify(out, null, 2) + '\n');
console.log(`results -> ${RESULTS_FILE}`);
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
