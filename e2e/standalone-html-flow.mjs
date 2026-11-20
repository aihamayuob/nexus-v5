// NEXUS — E2E for standalone/NEXUS-Standalone.html:  real Chromium -> HTML (served by scripts/nexus-standalone.mjs) -> BUILT backend (real OS process,
// real HTTP, on-disk SQLite) -> Gateway -> Mission planner/runner -> Evidence/Result -> HTML.
// Models are SIMULATED (fake Anthropic-protocol "cloud" + fake Ollama-protocol "local" on 127.0.0.1); nothing leaves the machine and no real key is used.
// It proves HTML<->API plumbing + the page's security properties. It does NOT prove model quality, real providers, or full WCAG conformance.
// Usage: (cd src-baseline/nexus-backend && npm ci && npm run build) && (cd e2e && npm i --no-save playwright@1.63.0) && node e2e/standalone-html-flow.mjs
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const PAGE_FILE = path.join(ROOT, 'standalone/NEXUS-Standalone.html');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.join(ROOT, 'scenario-out');
mkdirSync(path.join(OUT, 'shots'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d) => { results.push({ n, ok: !!ok, d: d == null ? '' : String(d).slice(0, 300) }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${d ? ' — ' + String(d).slice(0, 240) : ''}`); };
const KEY = 'sa-key-' + 'Qw3Rt7Yu1Op5As9D'; // test-only, >=16 chars, never a real secret

// ---- fake providers (same protocol shapes as e2e/operational-scenarios.mjs) ----
const cloud = { hits: 0 };
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; } };
const cloudSrv = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
  const body = await readBody(req); cloud.hits++;
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
  if (system.includes('مراجع مستقل صارم')) return reply(JSON.stringify({ verdict: 'ok', issues: [] }));
  const m = /TASK-(COLLECT|ANALYZE|REPORT)/.exec(lastUser);
  return reply(m ? 'SIMULATED-RESULT-' + m[1] : 'رد محاكى من السحابة');
});
let localHits = 0;
const localSrv = createServer(async (req, res) => {
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  await readBody(req); localHits++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'رد محاكى محلي' }, done: true, prompt_eval_count: 3, eval_count: 3 }));
});
const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)));
await Promise.all([listen(cloudSrv), listen(localSrv)]);

// ---- static properties of the shipped file ----
const html = readFileSync(PAGE_FILE, 'utf8');
try { execFileSync(process.execPath, [path.join(ROOT, 'scripts/standalone-csp.mjs'), '--check'], { stdio: 'pipe' }); check('CSP meta matches the sha256 of the inline code (no unsafe-inline/eval)', true); }
catch (e) { check('CSP meta matches the sha256 of the inline code', false, String(e.stderr || e.message)); }
check('single file: no external <script src>, no stylesheet link, no CDN/framework reference', !/<script[^>]*\ssrc=/i.test(html) && !/<link[^>]+rel=["']?stylesheet/i.test(html) && !/(unpkg|jsdelivr|cdnjs|googleapis|react|vite)/i.test(html), '');
check('no provider-key-shaped strings in the HTML', !/(sk-ant-|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|ghp_[A-Za-z0-9]{20,}|xox[bp]-)/.test(html), '');
const inlineJs = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
check('no persistent token storage: localStorage is only used for lang+base URL', !/localStorage[^;]*token/i.test(inlineJs) && /lsSet\('nexus\.(base|lang)'/.test(inlineJs) && !/lsSet\('nexus\.(token|key)/.test(inlineJs), '');
check('no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval in the page code (API data is text-only)', !/(\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function)/.test(inlineJs), '');

// ---- start the REAL launcher (page + built backend) ----
const UI = 19000 + Math.floor(Math.random() * 400), API = UI + 500;
const DB = path.join(mkdtempSync(path.join(tmpdir(), 'nexus-sa-')), 'n.db');
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
check('launcher: page origin served + backend up', up && /NEXUS Standalone is starting/.test(lout), up ? '' : lout.slice(0, 300));
const r404 = await fetch(`http://127.0.0.1:${UI}/etc/passwd`).then((r) => r.status);
const rpost = await fetch(PAGE_URL, { method: 'POST' }).then((r) => r.status);
const pageResp = await fetch(PAGE_URL);
check('launcher serves only the page (other paths 404, POST 405, nosniff)', r404 === 404 && rpost === 405 && pageResp.headers.get('x-content-type-options') === 'nosniff', `${r404}/${rpost}`);
const cors = await fetch(`${API_URL}/v2/health`, { headers: { Origin: `http://127.0.0.1:${UI}` } });
const corsBad = await fetch(`${API_URL}/v2/health`, { headers: { Origin: 'http://evil.example' } });
check('backend CORS allows ONLY the page origin (not loosened: foreign origin gets no ACAO)', cors.headers.get('access-control-allow-origin') === `http://127.0.0.1:${UI}` && !corsBad.headers.get('access-control-allow-origin'), `${cors.headers.get('access-control-allow-origin')} / ${corsBad.headers.get('access-control-allow-origin')}`);

const browser = await chromium.launch({ headless: true });
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(OUT, 'shots', `sa-${name}.png`), fullPage: true }); } catch { /* best effort */ } };

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, locale: opts.locale || 'ar', ...(opts.ctx || {}) });
  const page = await ctx.newPage();
  page.__reqs = []; page.__console = []; page.__errors = [];
  page.on('request', (r) => page.__reqs.push({ url: r.url(), method: r.method(), auth: r.headers()['authorization'] || '' }));
  page.on('console', (m) => page.__console.push(m.text()));
  page.on('pageerror', (e) => page.__errors.push(String(e)));
  return { ctx, page };
}
const txt = (page, sel) => page.locator(sel).innerText();
async function connect(page, base, key) {
  await page.fill('#baseUrl', base); await page.fill('#token', key); await page.click('#connectBtn');
}

try {
  // ================= desktop / Arabic default =================
  const { ctx, page } = await newPage({ locale: 'ar' });
  await page.goto(PAGE_URL);
  check('page loads, default Arabic RTL', (await page.getAttribute('html', 'dir')) === 'rtl' && (await page.getAttribute('html', 'lang')) === 'ar', '');
  check('initial state: idle banner, non-connect tabs disabled', (await page.locator('#banner.idle').count()) === 1 && await page.locator('#tabs button[data-tab=missions]').isDisabled(), '');
  await shot(page, 'ar-desktop-idle');

  // language switch
  await page.click('#langBtn');
  check('switch to English => LTR + English text', (await page.getAttribute('html', 'dir')) === 'ltr' && /Connect/.test(await txt(page, '#tabs button[data-tab=connect]')), '');
  await shot(page, 'en-desktop-idle');
  check('language choice persists across reload (localStorage nexus.lang)', await (async () => { await page.reload(); return (await page.getAttribute('html', 'lang')) === 'en'; })(), '');

  // invalid inputs
  await page.fill('#baseUrl', 'ftp://nope'); await page.fill('#token', 'x'); await page.click('#connectBtn');
  check('invalid URL scheme rejected client-side (no request sent)', /Invalid address/.test(await txt(page, '#connectMsg')) && !page.__reqs.some((r) => r.url.startsWith('ftp')), await txt(page, '#connectMsg'));
  await page.fill('#baseUrl', 'http://user:pw@127.0.0.1:1'); await page.click('#connectBtn');
  check('URL with embedded credentials rejected', /Invalid address/.test(await txt(page, '#connectMsg')), '');

  // backend unreachable
  const before = page.__reqs.length;
  await connect(page, 'http://127.0.0.1:9', KEY);
  await page.waitForSelector('#connectMsg .msg.bad');
  check('API unavailable => clear error, stays idle, key not retained', /Cannot reach the backend/.test(await txt(page, '#connectMsg')) && (await page.locator('#banner.idle').count()) === 1 && page.__reqs.length > before, await txt(page, '#connectMsg'));

  // wrong key
  await connect(page, API_URL, 'wrong-key-wrong-key-1');
  await page.waitForSelector('#connectMsg .msg.bad');
  check('wrong gateway key => 401 message, NOT connected', /invalid or missing \(401\)/.test(await txt(page, '#connectMsg')) && (await page.locator('#banner.live').count()) === 0, await txt(page, '#connectMsg'));

  // correct key
  await connect(page, API_URL, KEY);
  await page.waitForSelector('#banner.live', { timeout: 15000 });
  check('connect with real key => LIVE banner with backend address', (await txt(page, '#banner')).includes(API_URL), await txt(page, '#banner'));
  check('token field wiped after connect; health shown', (await page.inputValue('#token')) === '' && /true|1/.test(await txt(page, '#connectInfo')), '');
  const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  const ss = await page.evaluate(() => JSON.stringify(Object.assign({}, sessionStorage)));
  check('NO key in localStorage/sessionStorage/cookies', !ls.includes(KEY) && !ss.includes(KEY) && !(await page.evaluate(() => document.cookie)).includes(KEY), ls);
  await shot(page, 'en-desktop-connected');

  // capabilities
  await page.click('#tabs button[data-tab=caps]');
  await page.waitForFunction(() => document.querySelectorAll('#capsOut table').length >= 2, null, { timeout: 15000 });
  const caps = await txt(page, '#capsOut');
  check('capabilities: providers/models + provider health + warden rendered from the real backend', /anthropic|Anthropic/.test(caps) && /ollama|Ollama/i.test(caps) && /READY|NOT_CONFIGURED|DEGRADED|UNAVAILABLE/.test(caps) && /Warden/.test(caps), caps.slice(0, 160).replace(/\s+/g, ' '));
  check('capabilities: MCP client / A2A honestly shown as "Not enabled" (opt-in), not faked', /Not enabled/.test(caps), '');
  await shot(page, 'en-desktop-caps');

  // routing preview (no CLOUD/HYBRID options)
  await page.click('#tabs button[data-tab=route]');
  const modes = await page.locator('#routeMode option').allInnerTexts();
  check('routing modes = exactly the backend modes (no invented CLOUD/HYBRID)', JSON.stringify(modes) === JSON.stringify(['BEST', 'CHEAPEST', 'FASTEST', 'LOCAL_ONLY', 'PRIVATE', 'USER_SELECTED']), modes.join(','));
  await page.selectOption('#routeMode', 'LOCAL_ONLY'); await page.click('#routeForm button[type=submit]');
  await page.waitForSelector('#routeOut dl');
  const ro = await txt(page, '#routeOut');
  check('LOCAL_ONLY preview => ollama + cloud fallback blocked (from real /v2/route)', /ollama/.test(ro) && /yes/.test(ro), ro.replace(/\s+/g, ' '));

  // missions: validation then real mission
  await page.click('#tabs button[data-tab=missions]');
  await page.click('#missionBtn');
  check('empty objective rejected client-side', /Objective is required/.test(await txt(page, '#missionMsg')), '');
  await page.fill('#objective', 'x'); await page.fill('#cRatio', '7'); await page.click('#missionBtn');
  check('ratio out of range rejected client-side', /between 0 and 1/.test(await txt(page, '#missionMsg')), '');
  await page.fill('#cRatio', ''); await page.fill('#cReplans', '99'); await page.click('#missionBtn');
  check('replans out of range rejected client-side', /integer 0–10/.test(await txt(page, '#missionMsg')), '');
  await page.fill('#cReplans', '');

  const xssObjective = 'تقرير ثلاث مراحل <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>';
  await page.fill('#objective', xssObjective);
  await page.click('#cVer'); // run independent verification
  await page.click('#missionBtn');
  await page.waitForSelector('#missionMsg .msg.ok');
  check('mission accepted (202) with a real mission id', /\(202\)/.test(await txt(page, '#missionMsg')), await txt(page, '#missionMsg'));
  await page.waitForFunction(() => /COMPLETED|FAILED|CANCELLED/.test((document.querySelector('#mstate') || {}).innerText || ''), null, { timeout: 60000 });
  const det = await txt(page, '#mdetail');
  check('mission reaches COMPLETED via the real backend, progress + transitions shown', /COMPLETED/.test(await txt(page, '#mstate')) && /PLANNING/.test(det) && /RUNNING/.test(det), det.slice(0, 120).replace(/\s+/g, ' '));
  check('final result shown (simulated provider output)', /SIMULATED-RESULT-REPORT/.test(det), '');
  check('evidence/verification section rendered with a backend-declared status', /Evidence linked to this mission/.test(det) && /Verification/.test(det) && /(VERIFIED|SUPPORTED|UNCERTAIN|CONFLICTING|UNVERIFIED|ok|issues)/.test(det), '');
  check('task log (SSE/transition history) section present', /Execution log \(SSE\)/.test(det) && /Transition history/.test(det), '');
  check('XSS probe: objective rendered as TEXT, nothing executed, no <img onerror> element injected', (await page.evaluate(() => window.__xss === undefined)) && (await page.locator('#mdetail img, #missionList img').count()) === 0 && det.includes('<img src=x'), '');
  await shot(page, 'en-desktop-mission-completed');
  const apiStatus = await fetch(`${API_URL}/v2/missions/${/(?:plan|task|mission)_[A-Za-z0-9_\-]+/.exec(det)?.[0] || 'none'}`, { headers: { Authorization: 'Bearer ' + KEY } }).then((r) => r.status);
  check('the id shown in the UI exists on the backend (round trip)', apiStatus === 200, apiStatus);

  // network discipline
  const origins = new Set(page.__reqs.map((r) => new URL(r.url).origin));
  const allowed = new Set([`http://127.0.0.1:${UI}`, API_URL]);
  check('page contacted ONLY its own origin and the chosen API (no third party, no CDN)', [...origins].every((o) => allowed.has(o) || o === 'http://127.0.0.1:9'), [...origins].join(' '));
  const authed = page.__reqs.filter((r) => r.auth);
  check('Authorization header only ever sent to the chosen API origin', authed.length > 0 && authed.every((r) => r.url.startsWith(API_URL)), `${authed.length} authed requests`);
  check('key never appears in console output or page text', !page.__console.join('\n').includes(KEY) && !(await page.evaluate(() => document.documentElement.innerText)).includes(KEY), '');
  check('no uncaught page errors / CSP violations', page.__errors.length === 0 && !page.__console.some((c) => /Content Security Policy|Refused to/.test(c)), page.__errors.concat(page.__console.filter((c) => /Refused|Content Security/.test(c))).join(' | ').slice(0, 200));

  // evidence tab
  await page.click('#tabs button[data-tab=evidence]');
  await page.waitForFunction(() => document.querySelector('#evApprovals') && document.querySelector('#evApprovals').innerText.length > 0, null, { timeout: 10000 });
  check('evidence & governance tab renders approvals / receipts / claims (real endpoints)', (await page.locator('#evReceipts').innerText()).length > 0 && (await page.locator('#evClaims').innerText()).length > 0, '');

  // backend dies mid-session
  await page.click('#tabs button[data-tab=missions]');
  launcher.kill('SIGTERM'); for (let i = 0; i < 60 && (await fetch(`${API_URL}/v2/health`).then(() => true).catch(() => false)); i++) await sleep(250);
  await page.fill('#objective', 'after backend loss'); await page.click('#missionBtn');
  await page.waitForSelector('#missionMsg .msg.bad', { timeout: 25000 });
  check('backend lost mid-session => explicit error, UI alive (no crash, no fake success)', /Cannot reach the backend|Timed out/.test(await txt(page, '#missionMsg')) && page.__errors.length === 0, await txt(page, '#missionMsg'));
  await shot(page, 'en-desktop-backend-lost');

  // disconnect wipes state
  await page.click('#tabs button[data-tab=connect]'); await page.click('#disconnectBtn');
  check('disconnect => idle banner, mission pane cleared, tabs disabled again', (await page.locator('#banner.idle').count()) === 1 && (await page.locator('#mdetail').innerText()) === '' && await page.locator('#tabs button[data-tab=caps]').isDisabled(), '');

  // ---------- DEMO mode (same http page): labelled + isolated ----------
  const reqsBeforeDemo = page.__reqs.length;
  await page.click('#demoBtn');
  check('DEMO banner is explicit: DEMO / SIMULATED', /DEMO \/ SIMULATED/.test(await txt(page, '#banner')) && (await page.locator('#banner.demo').count()) === 1, await txt(page, '#banner'));
  await page.click('#tabs button[data-tab=missions]'); await page.fill('#objective', 'demo objective'); await page.click('#missionBtn');
  await page.waitForFunction(() => /COMPLETED/.test((document.querySelector('#mstate') || {}).innerText || ''), null, { timeout: 20000 });
  const dd = await txt(page, '#mdetail');
  check('demo result is labelled [SIMULATED] and verification UNVERIFIED (never presented as real)', /\[SIMULATED\]/.test(dd) && /UNVERIFIED/.test(dd), dd.slice(0, 100).replace(/\s+/g, ' '));
  check('demo mode made ZERO network requests', page.__reqs.length === reqsBeforeDemo, `${page.__reqs.length - reqsBeforeDemo} extra`);
  await shot(page, 'en-desktop-demo');
  await ctx.close();

  // ================= mobile / Arabic, fresh backend needed for live part =================
  // (launcher was stopped above; relaunch the backend+page for the remaining live checks)
} catch (e) {
  check('E2E main flow threw', false, e && e.stack ? e.stack : e);
}

// ---- restart launcher for mobile/phone + file:// checks ----
const launcher2 = spawn(process.execPath, [path.join(ROOT, 'scripts/nexus-standalone.mjs')], { env: { ...launcher.spawnargs && process.env, NEXUS_STANDALONE_PORT: String(UI), NEXUS_PORT: String(API), NEXUS_GATEWAY_KEYS: KEY, NEXUS_DB_PATH: DB, NEXUS_LOG_LEVEL: 'warn',
  NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudSrv.address().port}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key', NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${localSrv.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b',
  NEXUS_MAX_RETRIES: '0', NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000', NEXUS_CORS_ORIGINS: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let up2 = false;
for (let i = 0; i < 80 && !up2; i++) { await sleep(250); up2 = await fetch(`${API_URL}/v2/health`).then((r) => r.ok).catch(() => false); }
check('launcher restarted on the same DB (persistence across a backend restart)', up2, '');
try {
  const { ctx, page } = await newPage({ viewport: { width: 375, height: 667 }, locale: 'ar', ctx: { isMobile: true, hasTouch: true } });
  await page.goto(PAGE_URL);
  check('phone 375px: Arabic RTL, no horizontal overflow (idle)', (await page.getAttribute('html', 'dir')) === 'rtl' && await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth));
  await connect(page, API_URL, KEY);
  await page.waitForSelector('#banner.live', { timeout: 15000 });
  await page.click('#tabs button[data-tab=missions]');
  await page.fill('#objective', 'مهمة من الهاتف'); await page.click('#missionBtn');
  await page.waitForFunction(() => /COMPLETED|FAILED/.test((document.querySelector('#mstate') || {}).innerText || ''), null, { timeout: 60000 });
  check('phone: full mission flow completes in Arabic (COMPLETED)', /COMPLETED/.test(await txt(page, '#mstate')), await txt(page, '#mstate'));
  check('phone: no horizontal overflow with results rendered', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), await page.evaluate(() => document.documentElement.scrollWidth + '/' + document.documentElement.clientWidth));
  const small = await page.evaluate(() => [...document.querySelectorAll('button,input:not([type=checkbox]),select,textarea')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).length + [...document.querySelectorAll('label.check')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 40).length);
  check('phone: interactive controls >= 40px tall (touch target sanity; NOT a WCAG claim)', small === 0, `${small} small`);
  check('phone: every visible button/field has an accessible name', await page.evaluate(() => [...document.querySelectorAll('button,input,select,textarea')].filter((e) => e.offsetParent && !(e.innerText || e.getAttribute('aria-label') || (e.labels && e.labels[0] && e.labels[0].innerText) || e.getAttribute('placeholder')).trim()).length === 0), '');
  await shot(page, 'ar-phone-mission-completed');
  await page.click('#tabs button[data-tab=caps]');
  await page.waitForFunction(() => document.querySelectorAll('#capsOut table').length >= 2, null, { timeout: 15000 });
  check('phone: capabilities tab has no horizontal page overflow (tables scroll inside)', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), '');
  await shot(page, 'ar-phone-caps');
  await ctx.close();

  // ---- reload keeps NO token: a reloaded page is idle and needs the key again ----
  const c2 = await newPage({ locale: 'en' });
  await c2.page.goto(PAGE_URL); await connect(c2.page, API_URL, KEY); await c2.page.waitForSelector('#banner.live', { timeout: 15000 });
  await c2.page.reload();
  check('after reload the session is idle again (token was memory-only)', (await c2.page.locator('#banner.idle').count()) === 1 && (await c2.page.inputValue('#token')) === '', '');
  await c2.ctx.close();

  // ---- file:// behaviour (tested for real, not assumed) ----
  const c3 = await newPage({ locale: 'en' });
  await c3.page.goto('file://' + PAGE_FILE);
  check('file://: page loads and warns that backend calls are browser-restricted', await c3.page.locator('#fileWarn').isVisible() && /file:\/\//.test(await txt(c3.page, '#fileWarn')), '');
  await connect(c3.page, API_URL, KEY);
  await c3.page.waitForSelector('#connectMsg .msg.bad', { timeout: 20000 });
  const fileConn = await txt(c3.page, '#connectMsg');
  check('file://: connecting to the real backend FAILS (CORS: origin "null" not allowed) and the page says so — backend not loosened', /file:\/\//.test(fileConn) && (await c3.page.locator('#banner.live').count()) === 0, fileConn);
  await c3.page.click('#demoBtn'); await c3.page.click('#tabs button[data-tab=missions]'); await c3.page.fill('#objective', 'offline demo'); await c3.page.click('#missionBtn');
  await c3.page.waitForFunction(() => /COMPLETED/.test((document.querySelector('#mstate') || {}).innerText || ''), null, { timeout: 20000 });
  check('file://: DEMO/SIMULATED mode works offline and is labelled', /DEMO \/ SIMULATED/.test(await txt(c3.page, '#banner')) && /\[SIMULATED\]/.test(await txt(c3.page, '#mdetail')), '');
  await shot(c3.page, 'en-file-demo');
  check('file://: no uncaught page errors', c3.page.__errors.length === 0, c3.page.__errors.join('|'));
  await c3.ctx.close();
} catch (e) {
  check('E2E phase 2 threw', false, e && e.stack ? e.stack : e);
}

launcher2.kill('SIGTERM'); await sleep(500);
await browser.close(); cloudSrv.close(); localSrv.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(OUT, 'standalone-html-results.json'), JSON.stringify({ at: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2));
console.log(`\nstandalone-html-flow: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL (models SIMULATED; provider hits cloud=${cloud.hits} local=${localHits})`);
process.exit(failed.length ? 1 : 0);
