// NEXUS — E2E (gap closure) for standalone/NEXUS-Standalone.html: the page's ACTION buttons and evidence views against the REAL built backend.
// Closes gap 3 of docs/r4-backend-html-2026-11-20/03-…: pause / resume / cancel / approve / reject buttons, open-by-id, approvals list, claim evaluations,
// receipts view (honest empty state), plus the owner's review-notes tool (pick element, save, export, persistence, no secrets).
// Models are SIMULATED (fake Anthropic-protocol cloud with controllable behaviour). Nothing leaves the machine; no real key.
// Usage: (cd e2e && npm i --no-save playwright@1.63.0) && node e2e/standalone-html-actions.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };
const KEY = 'sa-key-' + 'Zx8Cv4Bn2Mq6Lk0J'; // test-only
const SECRET_NOTE = 'NOTE-SECRET-CANARY-' + 'h7Gf3Ds1'; // typed into the token field to prove notes never capture field values

// ---- fake cloud with controllable behaviour ----
const ctl = { slowMs: 0, issues: false, hits: 0 };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };
const cloudSrv = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
  const body = await readBody(req); ctl.hits++;
  const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system || '');
  const lastUser = JSON.stringify((body.messages || []).slice(-1)[0] || '');
  const reply = (text) => {
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const f = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
      f('message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } });
      f('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      f('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
      f('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
      f('message_stop', { type: 'message_stop' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
  };
  if (system.includes('أنت مخطط مهام')) return reply(JSON.stringify({ tasks: [
    { id: 'collect', description: 'TASK-COLLECT اجمع المعطيات', dependsOn: [] },
    { id: 'analyze', description: 'TASK-ANALYZE حلّل المعطيات', dependsOn: ['collect'] },
    { id: 'report', description: 'TASK-REPORT اكتب التقرير النهائي', dependsOn: ['analyze'] }] }));
  if (system.includes('مراجع مستقل صارم')) return reply(JSON.stringify(ctl.issues ? { verdict: 'issues_found', issues: ['ISSUE-FAKE-1 ادعاء غير مدعوم'] } : { verdict: 'ok', issues: [] }));
  if (system.includes('محرك تقييم أدلة مستقل')) return reply(JSON.stringify({ verdict: 'SUPPORTED', confidence: 0.8, rationale: 'RATIONALE-FAKE-JUDGE مصدر واحد يدعم الادعاء', supporting_count: 1, conflicting_count: 0 }));
  if (ctl.slowMs) await sleep(ctl.slowMs);
  const m = /TASK-(COLLECT|ANALYZE|REPORT)/.exec(lastUser);
  return reply(m ? 'SIMULATED-RESULT-' + m[1] : 'SIMULATED-SYNTHESIS رد محاكى من السحابة');
});
const localSrv = createServer(async (req, res) => {
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  await readBody(req);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'رد محاكى محلي' }, done: true, prompt_eval_count: 3, eval_count: 3 }));
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
await Promise.all([listen(cloudSrv), listen(localSrv)]);

const UI = 19500 + Math.floor(Math.random() * 400), API = UI + 500;
const DB = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-sa2-')), 'n.db');
const launcher = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-standalone.mjs')], {
  env: { ...process.env, NEXUS_STANDALONE_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_GATEWAY_KEYS: KEY, NEXUS_DB_PATH: DB, NEXUS_LOG_LEVEL: 'warn',
    NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudSrv.address().port}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key',
    NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${localSrv.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b',
    NEXUS_MAX_RETRIES: '0', NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000', NEXUS_CORS_ORIGINS: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let lout = ''; launcher.stdout.on('data', (d) => (lout += d)); launcher.stderr.on('data', (d) => (lout += d));
const PAGE_URL = `http://127.0.0.1:${UI}/NEXUS-Standalone.html`, API_URL = `http://127.0.0.1:${API}`;
let up = false;
for (let i = 0; i < 80 && !up; i++) { await sleep(250); up = await fetch(`${API_URL}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher up (page + built backend)', up, up ? '' : lout.slice(0, 300));

const authed = (p, init = {}) => fetch(API_URL + p, { ...init, headers: { Authorization: 'Bearer ' + KEY, 'content-type': 'application/json', ...(init.headers || {}) } });
const missionState = async (id) => (await (await authed('/v2/missions/' + id)).json()).state;
const browser = await chromium.launch({ headless: true });
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(OUT, 'shots', `sa2-${name}.png`), fullPage: true }); } catch { /* best effort */ } };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, locale: 'en', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { if (!localStorage.getItem('nexus.lang')) localStorage.setItem('nexus.lang', 'en'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  page.__errors = []; page.on('pageerror', (e) => page.__errors.push(String(e)));
  return { ctx, page };
}
const txt = (page, sel) => page.locator(sel).innerText();
async function connect(page) {
  await page.goto(PAGE_URL);
  await page.fill('#baseUrl', API_URL); await page.fill('#token', KEY); await page.click('#connectBtn');
  await page.waitForSelector('#banner.live', { timeout: 15000 });
}
const stateIs = (page, re, timeout = 60000) => page.waitForFunction((src) => new RegExp(src).test((document.querySelector('#mstate') || {}).innerText || ''), re.source, { timeout });
async function startMission(page, { verify = false, approval = false, objective = 'ACTION-TEST mission' } = {}) {
  await page.click('#tabs button[data-tab=missions]');
  await page.fill('#objective', objective);
  for (const [id, want] of [['#cVer', verify], ['#cAppr', approval]]) { if ((await page.isChecked(id)) !== want) await page.click(id); }
  await page.click('#missionBtn');
  await page.waitForSelector('#missionMsg .msg.ok');
  await page.waitForSelector('#mstate');
  return /(?:plan|task|mission)_[A-Za-z0-9_\-]+/.exec(await txt(page, '#mdetail'))?.[0];
}
const btn = (page, name) => page.locator('#mdetail .actions').getByRole('button', { name, exact: true });

try {
  const { ctx, page } = await newPage();
  await connect(page);

  // ===== PAUSE / RESUME (slow provider keeps the mission RUNNING) =====
  ctl.slowMs = 3000; ctl.issues = false;
  const idP = await startMission(page, { objective: 'PAUSE-RESUME mission' });
  check('mission id visible in the page after start', !!idP, idP);
  await stateIs(page, /RUNNING/, 30000);
  await btn(page, 'Pause').waitFor({ timeout: 10000 });
  check('RUNNING mission shows Pause and Cancel buttons (not Resume/Approve)', (await btn(page, 'Cancel').count()) === 1 && (await btn(page, 'Resume').count()) === 0 && (await btn(page, 'Approve').count()) === 0, '');
  await btn(page, 'Pause').click();
  await page.waitForSelector('#actMsg .msg.ok');
  await sleep(2500); // the page polls/re-renders every 1s: the confirmation must SURVIVE re-renders
  check('Pause click => POST /pause accepted and the page says so', /Action sent/.test(await txt(page, '#actMsg')), await txt(page, '#actMsg'));
  await stateIs(page, /PAUSED/, 40000);
  check('page state becomes PAUSED, backend agrees', (await missionState(idP)) === 'PAUSED', await txt(page, '#mstate'));
  await btn(page, 'Resume').waitFor({ timeout: 10000 });
  check('PAUSED mission shows Resume + Cancel (no Pause)', (await btn(page, 'Pause').count()) === 0 && (await btn(page, 'Cancel').count()) === 1, '');
  await shot(page, 'paused');
  ctl.slowMs = 300; // speed the remainder
  await btn(page, 'Resume').click();
  await page.waitForSelector('#actMsg .msg.ok');
  await stateIs(page, /COMPLETED|FAILED|CANCELLED/, 90000);
  check('Resume click => mission continues to COMPLETED with the final result (backend agrees)', /COMPLETED/.test(await txt(page, '#mstate')) && (await missionState(idP)) === 'COMPLETED' && /SIMULATED-RESULT-REPORT/.test(await txt(page, '#mdetail')), await txt(page, '#mstate'));
  check('after completion there are no action buttons', (await btn(page, 'Pause').count()) + (await btn(page, 'Resume').count()) + (await btn(page, 'Cancel').count()) === 0, '');

  // ===== CANCEL =====
  ctl.slowMs = 3000;
  const idC = await startMission(page, { objective: 'CANCEL mission' });
  await stateIs(page, /RUNNING/, 30000);
  await btn(page, 'Cancel').waitFor({ timeout: 10000 });
  await btn(page, 'Cancel').click();
  await page.waitForSelector('#actMsg .msg.ok');
  await stateIs(page, /CANCELLED|COMPLETED|FAILED/, 60000);
  check('Cancel click => mission reaches CANCELLED (page + backend)', /CANCELLED/.test(await txt(page, '#mstate')) && (await missionState(idC)) === 'CANCELLED', `${await txt(page, '#mstate')} / ${await missionState(idC)}`);
  check('CANCELLED mission has no action buttons (terminal)', (await btn(page, 'Pause').count()) + (await btn(page, 'Cancel').count()) === 0, '');
  await shot(page, 'cancelled');
  ctl.slowMs = 0;

  // ===== APPROVAL: approve from the mission pane =====
  ctl.issues = true;
  const idA = await startMission(page, { verify: true, approval: true, objective: 'APPROVE-FROM-PANE mission' });
  await stateIs(page, /AWAITING_APPROVAL/, 60000);
  await btn(page, 'Approve').waitFor({ timeout: 10000 });
  check('issues_found + requireApprovalOnIssues => AWAITING_APPROVAL with Approve + Reject buttons and a warning', (await btn(page, 'Reject').count()) === 1 && /human|approval|decision/i.test(await txt(page, '#mdetail')), '');
  check('the verifier issue text from the backend is shown (ISSUE-FAKE-1)', /ISSUE-FAKE-1/.test(await txt(page, '#mdetail')), '');
  const pend = await (await authed('/v2/approvals')).json();
  check('backend lists this mission as a pending approval', JSON.stringify(pend).includes(idA), '');
  await shot(page, 'awaiting-approval');
  await btn(page, 'Approve').click();
  await stateIs(page, /COMPLETED|FAILED/, 40000);
  check('Approve click => mission COMPLETED (page + backend)', /COMPLETED/.test(await txt(page, '#mstate')) && (await missionState(idA)) === 'COMPLETED', await txt(page, '#mstate'));

  // ===== APPROVAL: reject from the mission pane =====
  const idR = await startMission(page, { verify: true, approval: true, objective: 'REJECT-FROM-PANE mission' });
  await stateIs(page, /AWAITING_APPROVAL/, 60000);
  await btn(page, 'Reject').click();
  await stateIs(page, /FAILED|COMPLETED/, 40000);
  check('Reject click => mission FAILED (page + backend)', /FAILED/.test(await txt(page, '#mstate')) && (await missionState(idR)) === 'FAILED', await txt(page, '#mstate'));

  // ===== EVIDENCE TAB: pending approvals list + decide from there =====
  const idE = await startMission(page, { verify: true, approval: true, objective: 'APPROVE-FROM-EVIDENCE-TAB mission' });
  await stateIs(page, /AWAITING_APPROVAL/, 60000);
  await page.click('#tabs button[data-tab=evidence]');
  await page.waitForFunction((id) => (document.querySelector('#evApprovals') || {}).innerText.includes(id), idE, { timeout: 15000 });
  check('Evidence tab lists the pending approval with the real mission id', (await txt(page, '#evApprovals')).includes(idE), '');
  await shot(page, 'evidence-approvals');
  await page.locator('#evApprovals').getByRole('button', { name: 'Approve', exact: true }).first().click();
  await page.waitForFunction(() => /Action sent/.test((document.querySelector('#evApprovals') || {}).innerText || ''), null, { timeout: 15000 });
  await sleep(1500);
  check('Approve from the Evidence tab => backend mission COMPLETED', (await missionState(idE)) === 'COMPLETED', await missionState(idE));
  await page.click('#evRefresh');
  await page.waitForFunction(() => !/ACTION-TEST/.test((document.querySelector('#evApprovals') || {}).innerText || ''), null, { timeout: 10000 });
  check('after the decision the approval disappears from the pending list', !(await txt(page, '#evApprovals')).includes(idE), '');

  // ===== CLAIM EVALUATIONS (real stored records, simulated judge) + RECEIPTS (honest empty) =====
  const post = (b) => authed('/v2/evaluation/claim', { method: 'POST', body: JSON.stringify(b) });
  const c0 = await post({ claim: 'CLAIM-NOKIND الأرض كروية', evidence: [{ source: 'src-0', content: 'قياسات' }] });
  const c1 = await post({ claim: 'CLAIM-FAKE الأرض كروية', evidence: [{ source: 'src-1', content: 'قياسات تؤكد الشكل الكروي', kind: 'INDEPENDENT_SOURCE' }] });
  check('POST /v2/evaluation/claim stores real records (judge is SIMULATED)', c0.status === 200 && c1.status === 200, `${c0.status}/${c1.status}`);
  await page.click('#evRefresh');
  await page.waitForFunction(() => /CLAIM-FAKE/.test((document.querySelector('#evClaims') || {}).innerText || ''), null, { timeout: 15000 });
  const cl = await txt(page, '#evClaims');
  check('claims table: evidence WITH a declared kind => SUPPORTED + judge rationale shown', /SUPPORTED/.test(cl) && /RATIONALE-FAKE-JUDGE/.test(cl), cl.replace(/\s+/g, ' ').slice(0, 160));
  check('claims table: evidence WITHOUT a declared kind => backend honestly says UNVERIFIED (Evidence Integrity), page shows it as-is', /CLAIM-NOKIND/.test(cl) && /UNVERIFIED/.test(cl), '');
  const rc = await txt(page, '#evReceipts');
  check('receipts view is an honest empty state (no built-in tool declares an external effect => none fabricated)', /Nothing/i.test(rc) && !/ACKED/.test(rc), rc.replace(/\s+/g, ' ').slice(0, 120));
  await shot(page, 'evidence-claims');

  // ===== OPEN BY ID (fresh browser context = empty sessionStorage) =====
  const { ctx: ctx2, page: p2 } = await newPage();
  await connect(p2);
  await p2.click('#tabs button[data-tab=missions]');
  await p2.fill('#openId', 'bad id!'); await p2.click('#openBtn');
  check('open-by-id: malformed id rejected client-side', /id|invalid/i.test(await txt(p2, '#missionMsg')), await txt(p2, '#missionMsg'));
  await p2.fill('#openId', 'plan_00000000_deadbeef'); await p2.click('#openBtn');
  await p2.waitForSelector('#mdetail .msg.bad, #mdetail .msg.warn', { timeout: 15000 });
  check('open-by-id: unknown id => clear not-found error, no crash', /not found|404|exist/i.test(await txt(p2, '#mdetail')), (await txt(p2, '#mdetail')).slice(0, 100));
  await p2.fill('#openId', idP); await p2.click('#openBtn');
  await stateIs(p2, /COMPLETED/, 20000);
  check('open-by-id: a real completed mission opens with its result', /SIMULATED-RESULT-REPORT/.test(await txt(p2, '#mdetail')), '');
  await p2.fill('#openId', idC); await p2.click('#openBtn');
  await stateIs(p2, /CANCELLED/, 20000);
  check('open-by-id: the cancelled mission opens as CANCELLED', true, '');
  check('no uncaught page errors during the action flows', page.__errors.length === 0 && p2.__errors.length === 0, [...page.__errors, ...p2.__errors].join(' | '));
  await ctx2.close();

  // ===== REVIEW NOTES TOOL =====
  const { ctx: ctx3, page: n } = await newPage();
  await n.goto(PAGE_URL);
  check('notes: floating Note button present before connecting', await n.locator('#noteFab').isVisible(), '');
  check('notes: Notes tab is usable while idle (other tabs disabled)', !(await n.locator('#tabs button[data-tab=notes]').isDisabled()) && await n.locator('#tabs button[data-tab=missions]').isDisabled(), '');
  await n.fill('#token', SECRET_NOTE);
  await n.click('#noteFab');
  check('notes: FAB opens the note sheet', await n.locator('#noteSheet').isVisible() && /general/.test(await txt(n, '#nsTarget')), await txt(n, '#nsTarget'));
  await n.click('#nsPick');
  check('notes: pick mode from the sheet shows the hint and hides the sheet', await n.locator('#pickHint').isVisible() && !(await n.locator('#noteSheet').isVisible()), '');
  await n.hover('#token');
  check('notes: hovered element is outlined in pick mode', (await n.locator('#token.nx-hover').count()) === 1, '');
  await n.click('#token');
  check('notes: click picks the element WITHOUT activating it (sheet shows its selector)', await n.locator('#noteSheet').isVisible() && /input#token/.test(await txt(n, '#nsTarget')), await txt(n, '#nsTarget'));
  check('notes: the key field VALUE is not captured in the target description', !(await txt(n, '#nsTarget')).includes(SECRET_NOTE), await txt(n, '#nsTarget'));
  await n.click('#noteForm button[type=submit]');
  check('notes: empty note text rejected', /Write the note/.test(await txt(n, '#nsErr')), '');
  await n.selectOption('#nsCat', 'layout'); await n.selectOption('#nsSev', 'high');
  await n.fill('#nsText', 'الحقل ضيق جداً على الجوال — NOTE-ONE');
  await n.click('#noteForm button[type=submit]');
  check('notes: saved; sheet closes; FAB counter = 1', !(await n.locator('#noteSheet').isVisible()) && /\(1\)/.test(await txt(n, '#noteFab')), await txt(n, '#noteFab'));
  await n.keyboard.down('Alt'); await n.click('#langBtn'); await n.keyboard.up('Alt');
  check('notes: Alt+click picks an element (and does NOT toggle the language)', await n.locator('#noteSheet').isVisible() && /button#langBtn/.test(await txt(n, '#nsTarget')) && (await n.getAttribute('html', 'lang')) === 'en', await txt(n, '#nsTarget'));
  await n.fill('#nsText', 'زر اللغة يحتاج أيقونة — NOTE-TWO'); await n.selectOption('#nsCat', 'button');
  await n.click('#noteForm button[type=submit]');
  await n.click('#tabs button[data-tab=notes]');
  const list = await txt(n, '#noteList');
  check('notes: Notes tab lists both notes with category, severity and element', /NOTE-ONE/.test(list) && /NOTE-TWO/.test(list) && /High/.test(list) && /input#token/.test(list), '');
  await shot(n, 'notes-tab');
  const [dl] = await Promise.all([n.waitForEvent('download'), n.click('#noteMdBtn')]);
  const mdPath = await dl.path(); const md = readFileSync(mdPath, 'utf8');
  check('notes: Markdown export downloads a .md with both notes, targets and viewport context', /\.md$/.test(dl.suggestedFilename()) && /NOTE-ONE/.test(md) && /NOTE-TWO/.test(md) && /viewport=\d+x\d+/.test(md) && /input#token/.test(md), dl.suggestedFilename());
  const [dl2] = await Promise.all([n.waitForEvent('download'), n.click('#noteJsonBtn')]);
  const js = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
  check('notes: JSON export is valid JSON with 2 notes', Array.isArray(js.notes) && js.notes.length === 2, '');
  check('notes: NO secret in either export (the typed key canary is absent; the gateway key was never entered)', !md.includes(SECRET_NOTE) && !JSON.stringify(js).includes(SECRET_NOTE) && !md.includes(KEY), '');
  await n.click('#noteCopyBtn');
  check('notes: copy-to-clipboard puts the Markdown on the clipboard', /NOTE-ONE/.test(await n.evaluate(() => navigator.clipboard.readText())), '');
  const lsN = await n.evaluate(() => localStorage.getItem('nexus.notes') || '');
  check('notes: persisted only in localStorage nexus.notes (and without the canary)', /NOTE-ONE/.test(lsN) && !lsN.includes(SECRET_NOTE), '');
  await n.reload();
  await n.click('#tabs button[data-tab=notes]');
  check('notes: survive a reload', /NOTE-ONE/.test(await txt(n, '#noteList')) && /\(2\)/.test(await txt(n, '#noteFab')), '');
  await n.locator('#noteList .note').first().getByRole('button', { name: 'Delete' }).click();
  check('notes: delete removes one note', (await n.locator('#noteList .note').count()) === 1, '');
  n.once('dialog', (d) => d.accept());
  await n.click('#noteClearBtn');
  check('notes: clear all (after confirm) empties the list', /No notes yet/.test(await txt(n, '#noteList')), '');
  await n.click('#noteFab'); await n.keyboard.press('Escape');
  check('notes: Escape closes the sheet', !(await n.locator('#noteSheet').isVisible()), '');
  // XSS: note text and selectors are rendered as text
  await n.click('#noteFab'); await n.fill('#nsText', '<img src=x onerror="window.__nx=1"> NOTE-XSS'); await n.click('#noteForm button[type=submit]');
  await n.click('#tabs button[data-tab=notes]');
  check('notes: note text is rendered as text (no injected element, nothing executed)', (await n.evaluate(() => window.__nx === undefined)) && (await n.locator('#noteList img').count()) === 0 && /<img src=x/.test(await txt(n, '#noteList')), '');
  // Arabic/RTL + phone viewport
  await n.click('#langBtn'); // en -> ar
  check('notes: Arabic labels + RTL on the Notes tab', (await n.getAttribute('html', 'dir')) === 'rtl' && /ملاحظ/.test(await txt(n, '#tabs button[data-tab=notes]')), '');
  await n.setViewportSize({ width: 375, height: 700 });
  const ov = await n.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  await n.click('#noteFab');
  const fab = await n.locator('#noteFab').boundingBox(); const sheet = await n.locator('#noteSheet').boundingBox();
  const ov2 = await n.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check('notes: phone 375px — no horizontal overflow, FAB >= 44px, sheet inside the viewport', ov.sw <= ov.cw && ov2.sw <= ov2.cw && fab.height >= 44 && sheet.x >= -1 && sheet.x + sheet.width <= 376, `${ov.sw}/${ov.cw} fab=${Math.round(fab.height)}`);
  await shot(n, 'notes-phone-ar');
  check('notes: no uncaught page errors', n.__errors.length === 0, n.__errors.join(' | '));
  await ctx3.close(); await ctx.close();
} catch (e) {
  check('E2E harness completed without an unexpected exception', false, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : String(e));
} finally {
  await browser.close().catch(() => {});
  launcher.kill('SIGTERM');
  cloudSrv.close(); localSrv.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nstandalone-html-actions: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL (models SIMULATED; cloud hits=${ctl.hits})`);
if (failed.length) { for (const f of failed) console.log('  FAILED: ' + f.n); process.exit(1); }
