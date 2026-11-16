/* ==========================================================================
   e2e/phase2-core-slice11-context-characterization-flows.mjs — Phase 2 (/nexus-modularize), boundary 5/9 "core",
   CP-19: DESCRIPTIVE (characterization) test of how prompt context is composed through `fullAgentPrompt`:
     fullAgentPrompt(agent, q) = agent.prompt + (await ContextFabric.build(agent, q)).text
   It freezes what the code does TODAY (output structure + segment order, enricher gate, pinned agent knowledge, long-term memory,
   uploaded files, market context, per-source non-fatal isolation, task-state line). It does NOT judge that behavior as correct and it
   changes nothing in production code: there is no patch-specific (PS) check.
   Criteria were frozen before this file was written (outside the repository, in the CP-19 working report).

   Real HTML + real modules + real ContextFabric / NexusContext / NexusIntentEngine / routeEntries / retrieveLongTermMemoryContext /
   fileDocsContext / getMarketContext / PromptInjectionGuard / ExecutionCheckpoint (no stubs of app logic).
   Network: EVERY request is intercepted by a catch-all context.route handler (service workers blocked).
     https://nexus.test    -> static files from the frontend dir
     https://backend.test  -> fake backend, ONLY POST /api/embed and GET /api/market-context (everything else 404)
     anything else         -> aborted (and recorded; the final VALID check asserts only the deliberate probe went out)
   No live model, no external service. The clock is pinned (page.clock.setFixedTime), timezone UTC, locale en-US.

   Check kinds (tag in the name, printed as [KIND])
     VALID  measurement validity / controls — must always be green, else verdict INVALID
     PRES   behavior that must be preserved — green on the unmodified tree
   Final line:  S11-VERDICT = ACCEPTED | REJECTED | INVALID  (+ per-kind counts). Exit 0 iff ACCEPTED.

   NEXUS_FRONTEND_DIR points the script at another frontend dir (mutants / isolated copy). NEXUS_S11_RESULTS overrides the results JSON
   (default: <os tmpdir>/phase2-core-slice11-results.json — never inside the repository). Deterministic: no timings/timestamps.
   ========================================================================== */
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = process.env.NEXUS_FRONTEND_DIR ? path.resolve(process.env.NEXUS_FRONTEND_DIR) : path.resolve(HERE, '../frontend');
const RESULTS_FILE = process.env.NEXUS_S11_RESULTS || path.join(os.tmpdir(), 'phase2-core-slice11-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const ORIGIN = 'https://nexus.test';
const BACKEND = 'https://backend.test';
const FIXED = '2026-10-14T12:00:00.000Z';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
const STATE_KEYS = ['messages', 'selectedAgentIds', 'knowledgeBase', 'customAgents', 'longTermMemory', 'workflows', 'usageLog',
  'activeGroupId', 'uploadedDocs', 'projects', 'decisionJournal', 'topicMonitors', 'briefingLastSeenAt', 'agentOrder']; // activityLog/errorLog are volatile logs, excluded
const PROBE_URL = 'https://example.com/';

/* ------------------------------ result bookkeeping ------------------------------ */
const checks = [];
function rec(kind, name, ok, detail) {
  checks.push({ kind, name, ok: !!ok, detail: detail ?? null });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`);
}
// fn returns boolean | [boolean, detail]; a throw is a FAIL (never a crash of the whole run)
async function chk(kind, name, fn) {
  try { const r = await fn(); if (Array.isArray(r)) rec(kind, name, r[0], r[1]); else rec(kind, name, r === true, null); }
  catch (e) { rec(kind, name, false, 'threw: ' + String((e && e.message) || e).slice(0, 240)); }
}
const valid = (n, fn) => chk('VALID', n, fn);
const pres = (n, fn) => chk('PRES', n, fn);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function diff(got, want) {
  if (got === want) return 'equal';
  let i = 0; while (i < got.length && i < want.length && got[i] === want[i]) i++;
  return `first-diff@${i} got=${JSON.stringify(got.slice(Math.max(0, i - 24), i + 48))} want=${JSON.stringify(want.slice(Math.max(0, i - 24), i + 48))}`;
}
const eqText = (got, want) => [got === want, got === want ? null : diff(got, want)];

/* ------------------------------ fixtures (frozen) ------------------------------ */
const Q = 'ما سعر الذهب اليوم';
const Q_STATIC_FIN = 'اشرح لي معنى التضخم';      // static freshness, financial agent selected
const Q_MKT = 'ما سعر الذهب';                      // MARKET_WORDS only -> freshness 'recent' (not realtime)
const G0 = 'كيف حالك يا صديقي';                    // low risk / static / low complexity
const G1 = 'أريد شرح عقد إيجار';                   // legal selected -> risk medium only
const G2 = 'اكتب قصة قصيرة عن طفل يحب الحديقة والأشجار والزهور الملونة والطيور الصغيرة وهي تغني في الصباح الباكر بينما تمشي الجدة بجانبه وتحكي له حكايات قديمة عن القرية والجبال والأنهار الجارية بين الحقول الخضراء الواسعة';
const G3 = 'ما أحدث ما حدث اليوم';                 // freshness words -> realtime
const K1 = { id: 'k1', title: 'ك١', content: 'ملاحظة عن الذهب', embedding: [1, 0, 0] };
const K2 = { id: 'k2', title: 'ك٢', content: 'ملاحظة ثانية', embedding: [0.9, 0.4359, 0] };
const mem = (id, embedding) => ({ id, text: 'نص-' + id, embedding, ts: '2026-01-01T00:00:00.000Z', agentId: 'financial' });
const M = {
  m1: mem('m1', [1, 0, 0]), m4: mem('m4', [0.9, 0.43589, 0]), m2: mem('m2', [0.8, 0.6, 0]),
  m5: mem('m5', [0.75, 0.661438, 0]), m3: mem('m3', [0.7, 0.714143, 0]),
};
const LTM_ALL = [M.m3, M.m5, M.m2, M.m4, M.m1]; // stored out of score order on purpose
const chunk = (id, title, content, embedding) => ({ id, title, content, ...(embedding ? { embedding } : {}) });
const docsWith = (withEmb) => [{ id: 'd1', name: 'f', chunks: [
  chunk('c1', 't1', 'ملف١', withEmb ? [1, 0, 0] : null), chunk('c2', 't2', 'ملف٢', withEmb ? [0, 1, 0] : null), chunk('c3', 't3', 'ملف٣', withEmb ? [0.9, 0.43589, 0] : null)] }];
const DOCS = docsWith(true);
const MARKET_RESPONSE = { fetchedAt: '2026-10-14T11:00:00.000Z', goldPriceUsdPerOz: 2000, goldPriceUsdPerGram: 64.3, usdToLocalRate: 1.5, goldPriceLocalPerGram: 96.45 };
const SEED_CP = { taskId: 't1', phase: 'phaseA', results: { a: 1, b: 2 }, meta: {}, ts: 1 };
const agentFin = () => ({ id: 'financial', name: 'م', prompt: 'PROMPT-FIN', knowledge: [K1, K2] });
const agentFinNoK = () => ({ id: 'financial', name: 'م', prompt: 'PROMPT-FIN' });
const agentTechK = () => ({ id: 'tech', name: 'ت', prompt: 'PROMPT-T', knowledge: [K1, K2] });
const agentTechNoK = () => ({ id: 'tech', name: 'ت', prompt: 'PROMPT-T' });
const BASE = { backend: true, ltm: true, market: true, selected: ['financial'], mem: LTM_ALL, docs: DOCS, qs: [Q], cp: null };
const cfg = (o) => ({ ...BASE, ...o });
const LABELS_ALL4 = ['agent knowledge', 'long-term memory', 'uploaded documents', 'market context'];
const LABELS_3 = ['agent knowledge', 'long-term memory', 'uploaded documents'];

/* expected literal segments (format of PromptInjectionGuard.fence, quoted from modules/security.mjs) */
const fence = (label, text) => (text ? `\n\n--- ${label} (بيانات خارجية) ---\n${text}\n--- نهاية ${label} ---` : '');
const KNOW_BODY = (items) => 'معرفة خاصة بهذا الوكيل المخصص (مُنتقاة تلقائياً حسب صلتها بسؤالك):\n' + items.join('\n');
const KNOW_K1K2 = fence('معرفة وكيل مخصص', KNOW_BODY(['- ك١: ملاحظة عن الذهب', '- ك٢: ملاحظة ثانية']));
const memSeg = (ids) => '\n\nذاكرة طويلة المدى (مقتطفات ذات صلة من محادثات سابقة مع هذا المستخدم):\n' + ids.map((i) => '- ' + M[i].text).join('\n');
const MEM_BASE = memSeg(['m1', 'm4', 'm2']);
const FILES_BODY_RAW = 'مقاطع ذات صلة من ملفات رفعها المستخدم:\n- [من ملف "t1"]: ملف١\n- [من ملف "t3"]: ملف٣';
const FILES_SEG = fence('مستند مرفوع', FILES_BODY_RAW);
const marketBody = (S) => `سياق السوق الحالي (حقيقي، محدَّث ${S.marketDate}): سعر الذهب 2,000$ للأونصة (≈64.3$ للغرام). سعر الصرف: 1 دولار = 1.5 USD، أي ≈96.45 USD لغرام الذهب. استخدم هذه الأرقام إذا كانت ذات صلة بسؤال المستخدم، ولا تخترع أرقاماً أخرى.`;
const marketSeg = (S) => fence('بيانات سوقية', marketBody(S));
const timeSeg = (S) => `\n\n[السياق الزمني: الآن ${S.timeStr}]`;
const TASK_LINE = '\n\n[حالة المهمة: المرحلة الحالية "phaseA"، مراحل مكتملة سابقاً: a، b]';
const compose = (S, { prompt = 'PROMPT-FIN', know = '', memory = '', files = '', market = '', task = '' } = {}) => prompt + timeSeg(S) + know + memory + files + market + task;
const buildOnly = (S, parts) => compose(S, { ...parts, prompt: '' });
const SENT = { agentKnowledgeContext: 'SENT-agentKnowledgeContext', retrieveLongTermMemoryContext: 'SENT-retrieveLongTermMemoryContext', fileDocsContext: 'SENT-fileDocsContext', getMarketContext: 'SENT-getMarketContext' };
const INTENT_KEYS = ['intent', 'domain', 'subdomain', 'complexity', 'risk', 'freshness', 'requiredEvidence', 'requiredTools', 'expectedOutput', 'confidenceTarget', 'confidence'];

/* ------------------------------ harness ------------------------------ */
let browser = null;
const pageErrors = [];
const externalSeen = [];
let externalAborted = 0;
let chromiumVersion = '?';

async function newScenario() {
  const net = { embed: 'ok', market: 'ok', qSet: new Set(), embedMap: new Map(), log: [] };
  const ctx = await browser.newContext({ serviceWorkers: 'block', timezoneId: 'UTC', locale: 'en-US' });
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.origin === ORIGIN) {
      const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
      try { return await route.fulfill({ status: 200, contentType: MIME[path.extname(rel)] || 'application/octet-stream', body: await readFile(path.join(FRONTEND_DIR, rel)) }); }
      catch { return route.fulfill({ status: 404, body: 'not found' }); }
    }
    if (u.origin === BACKEND) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const json = { ...CORS, 'content-type': 'application/json' };
      if (req.method() === 'POST' && u.pathname === '/api/embed') {
        let text = null; try { text = (JSON.parse(req.postData() || '{}').texts || [])[0]; } catch { /* keep null */ }
        net.log.push({ kind: 'embed', text });
        if (net.embed === '500') return route.fulfill({ status: 500, headers: json, body: JSON.stringify({ error: 'embed-down' }) });
        const vec = net.embedMap.has(text) ? net.embedMap.get(text) : (net.qSet.has(text) ? [1, 0, 0] : [0, 0, 1]);
        return route.fulfill({ status: 200, headers: json, body: JSON.stringify({ embeddings: [vec] }) });
      }
      if (req.method() === 'GET' && u.pathname === '/api/market-context') {
        net.log.push({ kind: 'market', search: u.search });
        if (net.market === '500') return route.fulfill({ status: 500, headers: json, body: JSON.stringify({ error: 'market-down' }) });
        return route.fulfill({ status: 200, headers: json, body: JSON.stringify(MARKET_RESPONSE) });
      }
      net.log.push({ kind: 'backend-other', path: u.pathname });
      return route.fulfill({ status: 404, headers: json, body: '{}' });
    }
    externalSeen.push(req.url());
    await route.abort();
    externalAborted++;
  });
  const page = await ctx.newPage();
  const cons = [];
  page.on('console', (m) => cons.push(m.text()));
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.clock.setFixedTime(FIXED);
  return { ctx, page, net, cons };
}
async function boot(S) {
  await S.page.goto(ORIGIN + '/', { waitUntil: 'load' });
  try { await S.page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 }); }
  catch { return false; }
  S.timeStr = await S.page.evaluate((f) => new Intl.DateTimeFormat('ar', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(f)), FIXED);
  S.marketDate = await S.page.evaluate((f) => new Date(f).toLocaleString('ar', { timeZone: 'UTC' }), MARKET_RESPONSE.fetchedAt);
  return true;
}
async function installSpies(page) {
  await page.evaluate(() => {
    if (window.__t) return;
    window.__t = { labels: [], analyze: 0, persist: 0, intents: [] };
    window.__origSafe = NexusContext._safe;
    const origSafe = window.__origSafe;
    NexusContext._safe = async function (label, fn) { window.__t.labels.push(label); return origSafe.call(this, label, fn); };
    const origAnalyze = NexusIntentEngine.analyze;
    NexusIntentEngine.analyze = function (...a) { window.__t.analyze++; const r = origAnalyze.apply(this, a); window.__t.intents.push(r); return r; };
    const origPersist = window.persistState;
    window.persistState = function (...a) { window.__t.persist++; return origPersist.apply(this, a); };
    window.__orig = {};
    window.__inject = (n, f) => { if (!(n in window.__orig)) window.__orig[n] = window[n]; window[n] = f; };
    window.__restoreAll = () => { for (const n of Object.keys(window.__orig)) { window[n] = window.__orig[n]; delete window.__orig[n]; } };
  });
}
// Reset ALL per-cell state: settings, selection, memory, docs, caches, checkpoint, spies, network log/console.
async function setup(S, c) {
  S.net.embed = 'ok'; S.net.market = 'ok'; S.net.qSet = new Set(c.qs || []); S.net.embedMap = new Map(c.embedMap || []);
  await S.page.evaluate((x) => {
    try { if (window.__restoreAll) window.__restoreAll(); } catch (e) { /* none yet */ }
    const set = (k, v) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); };
    set('nexus_backend_url', x.backend ? 'https://backend.test' : null);
    set('nexus_ltm_enabled', x.ltm ? '1' : null);
    set('nexus_market_context_enabled', x.market ? 'true' : null);
    selectedAgentIds = x.selected; longTermMemory = x.mem; uploadedDocs = x.docs;
    marketContextCacheClient = null; _embeddingCache.clear(); ExecutionCheckpoint._mem = x.cp || null;
    if (window.__t) { window.__t.labels.length = 0; window.__t.analyze = 0; window.__t.persist = 0; window.__t.intents.length = 0; }
  }, c);
  S.net.log.length = 0; S.cons.length = 0;
}
const flush = (S) => S.page.evaluate(() => 0);
async function decorate(S, r) {
  await flush(S);
  r.embed = S.net.log.filter((x) => x.kind === 'embed'); r.marketReq = S.net.log.filter((x) => x.kind === 'market'); r.cons = S.cons.slice();
  return r;
}
async function runFull(S, agent, q) {
  S.net.log.length = 0; S.cons.length = 0;
  const r = await S.page.evaluate(async ({ agent, q }) => {
    const t = window.__t; t.labels.length = 0; t.analyze = 0; t.persist = 0; t.intents.length = 0;
    const text = await fullAgentPrompt(agent, q);
    return { text, labels: [...t.labels], analyze: t.analyze, persist: t.persist, intents: JSON.parse(JSON.stringify(t.intents)) };
  }, { agent, q });
  return decorate(S, r);
}
async function runBuild(S, agent, q, opts) {
  S.net.log.length = 0; S.cons.length = 0;
  const r = await S.page.evaluate(async ({ agent, q, opts }) => {
    const t = window.__t; t.labels.length = 0; t.analyze = 0; t.persist = 0; t.intents.length = 0;
    const b = await ContextFabric.build(agent, q, opts);
    return { text: b.text, intent: JSON.parse(JSON.stringify(b.intent)), labels: [...t.labels], analyze: t.analyze, persist: t.persist };
  }, { agent, q, opts });
  return decorate(S, r);
}
const inject = (S, name, mode) => S.page.evaluate(({ name, mode, sent }) => {
  if (mode === 'sentinel') window.__inject(name, async () => sent);
  else window.__inject(name, async () => { throw new Error('inj-' + name); });
}, { name, mode, sent: SENT[name] });
const restoreAll = (S) => S.page.evaluate(() => window.__restoreAll());
const count = (s, sub) => s.split(sub).length - 1;

/* ================================================================================================ */
try {
  browser = await chromium.launch();
  chromiumVersion = browser.version();

  // ===================== scenario A: validity + base cell (no spies yet), then spies =====================
  const A = await newScenario();
  let baseHashA = null;
  try {
    const inited = await boot(A);
    await valid('V01-boot-init', () => [inited, `inited=${inited}`]);
    if (!inited) throw new Error('boot failed');

    await valid('V02-clock-fixed', async () => {
      const r = await A.page.evaluate(async () => { const a = Date.now(); await new Promise((r) => setTimeout(r, 100)); return { a, b: Date.now(), iso: new Date().toISOString() }; });
      return [r.a === Date.parse(FIXED) && r.b === r.a && r.iso === FIXED, `a=${r.a} b=${r.b} iso=${r.iso}`];
    });
    await valid('V03-now-matches-Intl', async () => {
      const r = await A.page.evaluate((f) => ({
        now: ContextFabric.now(), want: new Intl.DateTimeFormat('ar', { dateStyle: 'full', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(f)),
      }), FIXED);
      const hasYear = /[0-9٠-٩]{4}/.test(r.now);
      return [r.now === r.want && r.now.length > 0 && hasYear && r.now === A.timeStr, `len=${r.now.length} hasYear=${hasYear}`];
    });
    await valid('V04-network-intercepted', async () => {
      const r = await A.page.evaluate(async (probe) => {
        const o = {};
        try { await fetch(probe); o.ext = 'reached'; } catch (e) { o.ext = 'blocked'; }
        try { o.nope = (await fetch('https://backend.test/api/__nope')).status; } catch (e) { o.nope = 'ERR'; }
        return o;
      }, PROBE_URL);
      return [r.ext === 'blocked' && r.nope === 404 && externalSeen.includes(PROBE_URL), JSON.stringify({ ext: r.ext, nope: r.nope })];
    });

    // spy-free base text, twice on the same page (V06) — before spies are installed
    await setup(A, BASE);
    const run0 = async () => A.page.evaluate(async (agent) => fullAgentPrompt(agent, 'ما سعر الذهب اليوم'), agentFin());
    const t1 = await run0(); const t2 = await run0();
    baseHashA = sha(t1);
    await valid('V06-determinism-same-page', () => [t1 === t2 && t1.length > 0, `len=${t1.length}`]);

    await installSpies(A.page);
    const base = (await setup(A, BASE), await runFull(A, agentFin(), Q));
    const EXP_BASE = compose(A, { know: KNOW_K1K2, memory: MEM_BASE, files: FILES_SEG, market: marketSeg(A) });

    // measured at the source: every one of the five sources yields a non-empty string for the fixtures (independent of how build() composes them)
    await valid('V05-fixtures-yield-all-five-segments', async () => {
      await setup(A, BASE);
      const r = await A.page.evaluate(async (agent) => {
        const q = 'ما سعر الذهب اليوم';
        return [ContextFabric.now(), await agentKnowledgeContext(agent, q), await retrieveLongTermMemoryContext(q), await fileDocsContext(q), await getMarketContext()];
      }, agentFin());
      const have = r.map((x) => typeof x === 'string' && x.length > 0);
      return [have.every(Boolean), JSON.stringify(have)];
    });
    await valid('V13-spy-records-labels', () => [base.labels.length > 0 && base.labels.every((l) => typeof l === 'string' && l.length > 0), JSON.stringify(base.labels)]);

    // ---------- P01..P04 ----------
    await pres('P01-prompt-plus-build-text', async () => {
      await setup(A, BASE);
      const r = await A.page.evaluate(async (agent) => {
        const a = await fullAgentPrompt(agent, 'ما سعر الذهب اليوم');
        const b = await ContextFabric.build(agent, 'ما سعر الذهب اليوم');
        return { eq: a === agent.prompt + b.text, textType: typeof b.text, intentType: typeof b.intent, keys: Object.keys(b.intent), types: { requiredTools: Array.isArray(b.intent.requiredEvidence), req: typeof b.intent.requiredEvidence, conf: typeof b.intent.confidence } };
      }, agentFin());
      const keysOk = same([...r.keys].sort(), [...INTENT_KEYS].sort());
      return [r.eq && r.textType === 'string' && r.intentType === 'object' && keysOk, `eq=${r.eq} keysOk=${keysOk}`];
    });
    await pres('P02-time-segment-first-exact', () => {
      const want = 'PROMPT-FIN' + timeSeg(A);
      return [base.text.startsWith(want), base.text.startsWith(want) ? null : diff(base.text.slice(0, want.length), want)];
    });
    await pres('P03-segment-order', () => {
      const t = base.text;
      const pos = [t.indexOf('[السياق الزمني: الآن '), t.indexOf('معرفة وكيل مخصص'), t.indexOf('ذاكرة طويلة المدى'), t.indexOf('مستند مرفوع'), t.indexOf('بيانات سوقية')];
      const inc = pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1]));
      return [inc && same(base.labels, LABELS_ALL4), JSON.stringify({ pos, labels: base.labels })];
    });
    await pres('P04-baseline-segments-exact', () => {
      const nums = ['2,000', '64.3', '1.5', '96.45'].every((n) => base.text.includes(n));
      const [ok, d] = eqText(base.text, EXP_BASE);
      return [ok && nums, d];
    });

    // ---------- P05..P08 pinned knowledge ----------
    await pres('P05-pinned-knowledge-on-low-intent', async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const r = await runFull(A, agentTechK(), G0);
      const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-T', know: KNOW_K1K2 }));
      return [ok && same(r.labels, ['agent knowledge']) && r.embed.length === 1 && r.marketReq.length === 0, `${d} labels=${JSON.stringify(r.labels)} embed=${r.embed.length}`];
    });
    await pres('P06-no-knowledge-no-segment', async () => {
      await setup(A, BASE);
      const r = await runFull(A, agentFinNoK(), Q);
      return [!r.text.includes('معرفة وكيل مخصص') && r.labels[0] === 'agent knowledge', JSON.stringify(r.labels)];
    });
    await pres('P07-knowledge-topK-3', async () => {
      await setup(A, cfg({ backend: false, ltm: false, market: false, selected: ['tech'], mem: [], docs: [], qs: [] }));
      const four = [['ع١', 'تفاح وموز وبرتقال'], ['ع٢', 'سيارة وطائرة وقطار'], ['ع٣', 'شمس وقمر ونجوم'], ['ع٤', 'قلم ودفتر وكتاب']].map(([t, c], i) => ({ id: 'e' + (i + 1), title: t, content: c }));
      const r = await runFull(A, { id: 'tech', name: 'ت', prompt: 'PROMPT-T', knowledge: four }, G0);
      const lines = r.text.split('\n').filter((l) => l.startsWith('- ')).length;
      return [lines === 3 && r.text.includes('معرفة وكيل مخصص') && r.embed.length === 0, `lines=${lines} embed=${r.embed.length}`];
    });
    await pres('P08-knowledge-fenced-label', () => {
      const open = '\n\n--- معرفة وكيل مخصص (بيانات خارجية) ---\nمعرفة خاصة بهذا الوكيل المخصص';
      const close = '\n--- نهاية معرفة وكيل مخصص ---';
      return [base.text.includes(open) && base.text.includes(close) && base.text.indexOf(open) < base.text.indexOf(close), null];
    });

    // ---------- gate cells (P09..P12) + V14 ----------
    await pres('P09-gate-G0-low-static', async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const r = await runFull(A, agentTechNoK(), G0);
      const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-T' }));
      return [ok && same(r.labels, ['agent knowledge']) && r.embed.length === 0 && r.marketReq.length === 0, `${d} labels=${JSON.stringify(r.labels)} embed=${r.embed.length} market=${r.marketReq.length}`];
    });
    const gateCell = async (name, selected, q, declared) => {
      let r = null;
      await pres(name, async () => {
        await setup(A, cfg({ selected, qs: [q] }));
        r = await runFull(A, agentTechK(), q);
        const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-T', know: KNOW_K1K2, memory: MEM_BASE, files: FILES_SEG }));
        return [ok && same(r.labels, LABELS_3), `${d} labels=${JSON.stringify(r.labels)}`];
      });
      await valid('V14-' + name.split('-')[0] + '-intent-as-declared', () => {
        const it = r && r.intents && r.intents[0];
        if (!it) return [false, 'no intent captured'];
        const bad = Object.entries(declared).filter(([k, v]) => it[k] !== v).map(([k]) => k);
        return [bad.length === 0, bad.length ? 'mismatch:' + bad.join(',') + ' got=' + JSON.stringify(Object.fromEntries(Object.keys(declared).map((k) => [k, it[k]]))) : null];
      });
    };
    await valid('V14-P09-intent-as-declared', async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const r = await runFull(A, agentTechNoK(), G0);
      const it = r.intents[0] || {};
      const want = { risk: 'low', freshness: 'static', complexity: 'low', requiredEvidence: false };
      const bad = Object.entries(want).filter(([k, v]) => it[k] !== v).map(([k]) => k);
      return [bad.length === 0, bad.join(',') || null];
    });
    await gateCell('P10-gate-G1-risk-only', ['legal'], G1, { risk: 'medium', requiredEvidence: true, complexity: 'low', freshness: 'static' });
    await gateCell('P11-gate-G2-complexity-only', ['tech'], G2, { risk: 'low', freshness: 'static', complexity: 'medium', requiredEvidence: false, intent: 'create' });
    await gateCell('P12-gate-G3-freshness', ['tech'], G3, { freshness: 'realtime', requiredEvidence: true });

    // ---------- P13..P17 direct build() with explicit intents ----------
    const intentOf = (o) => ({ requiredEvidence: false, complexity: 'low', freshness: 'static', domain: 'tech', ...o });
    const buildCell = async (name, o, wantLabels, wantFull) => pres(name, async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const r = await runBuild(A, agentTechK(), G0, { intent: intentOf(o) });
      const [ok, d] = eqText(r.text, buildOnly(A, wantFull ? { know: KNOW_K1K2, memory: MEM_BASE, files: FILES_SEG } : { know: KNOW_K1K2 }));
      return [ok && same(r.labels, wantLabels) && r.analyze === 0, `${d} labels=${JSON.stringify(r.labels)} analyze=${r.analyze}`];
    });
    await buildCell('P13-build-requiredEvidence-only', { requiredEvidence: true }, LABELS_3, true);
    await buildCell('P14-build-complexity-medium-only', { complexity: 'medium' }, LABELS_3, true);
    await buildCell('P15-build-freshness-recent-only', { freshness: 'recent' }, LABELS_3, true);
    await buildCell('P16-build-all-negative-knowledge-only-analyze-not-called', {}, ['agent knowledge'], false);
    await pres('P17-analyze-called-once-without-intent', async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const b = await runBuild(A, agentTechK(), G0, {});
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const f = await runFull(A, agentTechK(), G0);
      return [b.analyze === 1 && f.analyze === 1, `build=${b.analyze} full=${f.analyze}`];
    });

    // ---------- P18 long-term memory ----------
    await pres('P18-ltm-selection-exact', async () => {
      await setup(A, cfg({ selected: ['financial'], docs: [] }));
      const a = await runFull(A, agentTechNoK(), Q);
      const [okA, dA] = eqText(a.text, compose(A, { prompt: 'PROMPT-T', memory: MEM_BASE }));
      await setup(A, cfg({ selected: ['financial'], docs: [], mem: [M.m3, M.m2] })); // threshold isolation: 0.70 must be dropped, 0.80 kept
      const b = await runFull(A, agentTechNoK(), Q);
      const [okB, dB] = eqText(b.text, compose(A, { prompt: 'PROMPT-T', memory: memSeg(['m2']) }));
      const unfenced = !a.text.includes('--- ذاكرة طويلة المدى');
      return [okA && okB && unfenced && !a.text.includes(M.m3.text) && !a.text.includes(M.m5.text), `full:${dA} threshold:${dB} unfenced=${unfenced}`];
    });
    await pres('P19-ltm-gates', async () => {
      const exp = (S, withMarket) => compose(S, { prompt: 'PROMPT-FIN', market: withMarket ? marketSeg(S) : '' });
      const cases = [
        ['flag-off', cfg({ ltm: false, docs: [] }), true],
        ['no-backend', cfg({ backend: false, docs: [] }), false],
        ['empty-memory', cfg({ mem: [], docs: [] }), true],
      ];
      const out = [];
      for (const [nm, c, withMarket] of cases) {
        await setup(A, c);
        const r = await runFull(A, agentFinNoK(), Q);
        out.push([nm, r.text === exp(A, withMarket) && !r.text.includes('ذاكرة طويلة المدى') && r.embed.length === 0, r.text === exp(A, withMarket) ? '' : diff(r.text, exp(A, withMarket))]);
      }
      return [out.every((x) => x[1]), out.map((x) => `${x[0]}:${x[1]}${x[2] ? ' ' + x[2] : ''}`).join(' | ')];
    });
    await pres('P20-ltm-embed-500-non-fatal', async () => {
      await setup(A, cfg({ docs: [] }));
      A.net.embed = '500';
      const r = await runFull(A, agentFinNoK(), Q);
      const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-FIN', market: marketSeg(A) }));
      const logged = r.cons.some((c) => c.startsWith('Long-term memory retrieval failed (non-fatal)'));
      return [ok && logged, `${d} logged=${logged}`];
    });

    // ---------- P21..P25 uploaded files ----------
    await pres('P21-files-backend-routing', async () => {
      await setup(A, cfg({ selected: ['tech'], mem: [] }));
      const r = await runFull(A, agentTechNoK(), Q);
      const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-T', files: FILES_SEG }));
      return [ok && !r.text.includes('ملف٢') && r.text.includes('- [من ملف "t1"]: ملف١'), d];
    });
    await pres('P22-files-no-backend-tfidf', async () => {
      await setup(A, cfg({ backend: false, ltm: false, market: false, selected: ['tech'], mem: [], qs: [],
        docs: [{ id: 'dx', name: 'x', chunks: [chunk('x1', 'عنوان١', 'الطقس مشمس في الحديقة'), chunk('x2', 'عنوان٢', 'سعر الذهب اليوم ارتفع'), chunk('x3', 'عنوان٣', 'كرة القدم رياضة شعبية'), chunk('x4', 'عنوان٤', 'الطبخ يحتاج صبرا'), chunk('x5', 'عنوان٥', 'الموسيقى تهدئ النفس')] }] }));
      const r = await runFull(A, agentTechNoK(), Q);
      const lines = r.text.split('\n').filter((l) => l.startsWith('- [من ملف'));
      const fenced = r.text.includes('\n\n--- مستند مرفوع (بيانات خارجية) ---\n') && r.text.includes('\n--- نهاية مستند مرفوع ---');
      return [lines.length <= 3 && lines.length >= 1 && lines[0] === '- [من ملف "عنوان٢"]: سعر الذهب اليوم ارتفع' && fenced && r.embed.length === 0, `lines=${lines.length} first=${JSON.stringify(lines[0])} fenced=${fenced}`];
    });
    await pres('P23-files-empty-no-segment', async () => {
      await setup(A, cfg({ selected: ['tech'], mem: [], docs: [] }));
      const r = await runFull(A, agentTechNoK(), Q);
      return [!r.text.includes('مستند مرفوع') && r.labels.includes('uploaded documents') && r.text === compose(A, { prompt: 'PROMPT-T' }), JSON.stringify(r.labels)];
    });
    await pres('P24-files-embed-500-falls-back-to-tfidf', async () => {
      await setup(A, cfg({ selected: ['tech'], mem: [] }));
      A.net.embed = '500';
      const r = await runFull(A, agentTechNoK(), Q);
      const logged = r.cons.some((c) => c.startsWith('Context router embeddings failed, falling back to local TF-IDF'));
      return [r.text.includes('ملف١') && r.text.includes('مستند مرفوع') && logged, `logged=${logged}`];
    });
    await pres('P25-files-lazy-embed-side-effect', async () => {
      const embedMap = [['t1: ملف١', [1, 0, 0]], ['t2: ملف٢', [0, 1, 0]], ['t3: ملف٣', [0.9, 0.43589, 0]]];
      await setup(A, cfg({ selected: ['tech'], mem: [], docs: docsWith(false), embedMap }));
      const r = await runFull(A, agentTechNoK(), Q);
      const allEmb = await A.page.evaluate(() => uploadedDocs[0].chunks.every((c) => Array.isArray(c.embedding)));
      const [ok, d] = eqText(r.text, compose(A, { prompt: 'PROMPT-T', files: FILES_SEG }));
      // control: precomputed embeddings -> no lazy embedding, no persist, only the query is embedded
      await setup(A, cfg({ selected: ['tech'], mem: [] }));
      const c = await runFull(A, agentTechNoK(), Q);
      return [ok && allEmb && r.embed.length === 4 && r.persist >= 1 && c.persist === 0 && c.embed.length === 1,
        `${d} allEmb=${allEmb} embed=${r.embed.length} persist=${r.persist} ctrl(persist=${c.persist},embed=${c.embed.length})`];
    });

    // ---------- P26..P32 market ----------
    const mktExp = (S, prompt) => compose(S, { prompt, market: marketSeg(S) });
    await pres('P26-market-financial-domain-business', async () => {
      await setup(A, cfg({ selected: ['financial'], mem: [], docs: [], qs: [Q_STATIC_FIN] }));
      const r = await runFull(A, agentFinNoK(), Q_STATIC_FIN);
      const it = r.intents[0] || {};
      const [ok, d] = eqText(r.text, mktExp(A, 'PROMPT-FIN'));
      return [ok && it.freshness === 'static' && it.domain === 'business' && r.marketReq.length === 1 && r.marketReq[0].search === '?currency=USD' && same(r.labels, LABELS_ALL4),
        `${d} fresh=${it.freshness} domain=${it.domain} req=${r.marketReq.length}`];
    });
    await pres('P27-market-freshness-branch', async () => {
      await setup(A, cfg({ selected: ['tech'], mem: [], docs: [], qs: [Q_MKT] }));
      const r = await runFull(A, agentFinNoK(), Q_MKT);
      const it = r.intents[0] || {};
      const [ok, d] = eqText(r.text, mktExp(A, 'PROMPT-FIN'));
      return [ok && it.freshness === 'recent' && it.domain === 'tech' && r.marketReq.length === 1, `${d} fresh=${it.freshness} domain=${it.domain}`];
    });
    await pres('P28-market-excluded-static-nonbusiness', async () => {
      await setup(A, cfg({ selected: ['tech'], qs: [G0] }));
      const r = await runFull(A, agentFin(), G0);
      return [!r.labels.includes('market context') && r.marketReq.length === 0 && !r.text.includes('بيانات سوقية'), JSON.stringify(r.labels)];
    });
    await pres('P29-market-excluded-non-financial-agent', async () => {
      await setup(A, cfg({ selected: ['financial'], mem: [], docs: [] }));
      const r = await runFull(A, agentTechNoK(), Q);
      return [!r.labels.includes('market context') && r.marketReq.length === 0 && !r.text.includes('بيانات سوقية'), JSON.stringify(r.labels)];
    });
    await pres('P30-market-gates', async () => {
      const out = [];
      for (const [nm, c] of [['flag-off', cfg({ market: false, mem: [], docs: [] })], ['no-backend', cfg({ backend: false, mem: [], docs: [] })]]) {
        await setup(A, c);
        const r = await runFull(A, agentFinNoK(), Q);
        out.push([nm, r.labels.includes('market context') && r.text === compose(A, { prompt: 'PROMPT-FIN' }) && r.marketReq.length === 0]);
      }
      return [out.every((x) => x[1]), out.map((x) => x.join(':')).join(' | ')];
    });
    await pres('P31-market-500-non-fatal-no-cache', async () => {
      await setup(A, cfg({ mem: [], docs: [] }));
      A.net.market = '500';
      const r1 = await runFull(A, agentFinNoK(), Q);
      const logged = r1.cons.some((c) => c.startsWith('Market context fetch failed:'));
      A.net.market = 'ok';
      const r2 = await runFull(A, agentFinNoK(), Q);
      return [r1.text === compose(A, { prompt: 'PROMPT-FIN' }) && logged && r1.marketReq.length === 1 && r2.text === mktExp(A, 'PROMPT-FIN') && r2.marketReq.length === 1,
        `first=${r1.marketReq.length} second=${r2.marketReq.length} logged=${logged}`];
    });
    await pres('P32-market-client-cache', async () => {
      await setup(A, cfg({ mem: [], docs: [] }));
      const r1 = await runFull(A, agentFinNoK(), Q);
      A.net.log.length = 0;
      const r2 = await runFull(A, agentFinNoK(), Q);
      return [r1.marketReq.length === 1 && r2.marketReq.length === 0 && r1.text === r2.text && r2.text === mktExp(A, 'PROMPT-FIN'), `first=${r1.marketReq.length} second=${r2.marketReq.length}`];
    });

    // ---------- injection targeting (V08..V12) + per-source fault isolation (P33..P36) + P37 ----------
    const VMAP = { agentKnowledgeContext: 'V08', retrieveLongTermMemoryContext: 'V09', fileDocsContext: 'V10', getMarketContext: 'V11' };
    for (const fn of Object.keys(VMAP)) {
      await valid(`${VMAP[fn]}-inj-target-${fn}`, async () => {
        await setup(A, BASE);
        const before = await runFull(A, agentFin(), Q);
        await inject(A, fn, 'sentinel');
        const r = await runFull(A, agentFin(), Q);
        return [r.text.includes(SENT[fn]) && r.text !== before.text, `sentinel=${r.text.includes(SENT[fn])} changed=${r.text !== before.text}`];
      });
    }
    await valid('V12-restore-returns-baseline', async () => {
      await setup(A, BASE);
      for (const fn of Object.keys(SENT)) await inject(A, fn, 'sentinel');
      await restoreAll(A);
      const r = await runFull(A, agentFin(), Q);
      return eqText(r.text, base.text);
    });
    const FAULT = [
      ['P33-fault-isolation-agentKnowledgeContext', 'agentKnowledgeContext', 'agent knowledge', { memory: MEM_BASE, files: FILES_SEG, market: 'M' }],
      ['P34-fault-isolation-retrieveLongTermMemoryContext', 'retrieveLongTermMemoryContext', 'long-term memory', { know: KNOW_K1K2, files: FILES_SEG, market: 'M' }],
      ['P35-fault-isolation-fileDocsContext', 'fileDocsContext', 'uploaded documents', { know: KNOW_K1K2, memory: MEM_BASE, market: 'M' }],
      ['P36-fault-isolation-getMarketContext', 'getMarketContext', 'market context', { know: KNOW_K1K2, memory: MEM_BASE, files: FILES_SEG }],
    ];
    for (const [name, fn, label, rest] of FAULT) {
      await pres(name, async () => {
        await setup(A, BASE);
        await inject(A, fn, 'throw');
        const r = await runFull(A, agentFin(), Q);
        const parts = { ...rest }; if (parts.market === 'M') parts.market = marketSeg(A);
        const [ok, d] = eqText(r.text, compose(A, parts));
        const logged = r.cons.includes(`NexusContext: ${label} failed (non-fatal): inj-${fn}`);
        return [ok && logged && same(r.labels, LABELS_ALL4), `${d} logged=${logged}`];
      });
    }
    await pres('P37-sentinel-placement', async () => {
      await setup(A, BASE);
      for (const fn of Object.keys(SENT)) await inject(A, fn, 'sentinel');
      const r = await runFull(A, agentFin(), Q);
      const want = compose(A, { know: SENT.agentKnowledgeContext, memory: SENT.retrieveLongTermMemoryContext,
        files: fence('مستند مرفوع', SENT.fileDocsContext), market: fence('بيانات سوقية', SENT.getMarketContext) });
      const [ok, d] = eqText(r.text, want);
      return [ok && !r.text.includes('--- معرفة وكيل مخصص') && !r.text.includes('--- ذاكرة طويلة المدى'), d];
    });
    await restoreAll(A);

    // ---------- P38 _safe direct ----------
    await pres('P38-safe-direct', async () => {
      await setup(A, BASE);
      const r = await A.page.evaluate(async () => {
        const ok = await window.__origSafe.call(NexusContext, 'lbl-ok', async () => 'VAL');
        const bad = await window.__origSafe.call(NexusContext, 'lbl-bad', async () => { throw new Error('boom'); });
        const sync = await window.__origSafe.call(NexusContext, 'lbl-sync', () => { throw new Error('boom2'); });
        return { ok, bad, sync };
      });
      await flush(A);
      return [r.ok === 'VAL' && r.bad === '' && r.sync === '' && A.cons.includes('NexusContext: lbl-bad failed (non-fatal): boom') && A.cons.includes('NexusContext: lbl-sync failed (non-fatal): boom2'), JSON.stringify(r)];
    });

    // ---------- task state: V15, P39, P40 ----------
    await valid('V15-checkpoint-seeded', async () => {
      await setup(A, cfg({ cp: SEED_CP }));
      const r = await A.page.evaluate(() => ExecutionCheckpoint.peek('t1'));
      return [same(r, SEED_CP), JSON.stringify(r)];
    });
    await pres('P39-fullAgentPrompt-never-includes-task-state', async () => {
      await setup(A, cfg({ cp: SEED_CP }));
      const r = await runFull(A, agentFin(), Q);
      return [!r.text.includes('[حالة المهمة') && r.text === EXP_BASE, null];
    });
    await pres('P40-build-taskId-line-exact', async () => {
      await setup(A, cfg({ cp: SEED_CP }));
      const withT = await runBuild(A, agentFin(), Q, { taskId: 't1' });
      const baseB = await runBuild(A, agentFin(), Q, {});
      const [ok1, d1] = eqText(withT.text, baseB.text + TASK_LINE);
      await setup(A, cfg({ cp: { ...SEED_CP, results: {} } }));
      const empty = await runBuild(A, agentFin(), Q, { taskId: 't1' });
      const okEmpty = empty.text === baseB.text + '\n\n[حالة المهمة: المرحلة الحالية "phaseA"، مراحل مكتملة سابقاً: لا شيء بعد]';
      await setup(A, cfg({ cp: SEED_CP }));
      const other = await runBuild(A, agentFin(), Q, { taskId: 't2' });
      await setup(A, cfg({ cp: null }));
      const none = await runBuild(A, agentFin(), Q, { taskId: 't1' });
      return [ok1 && okEmpty && other.text === baseB.text && none.text === baseB.text && baseB.text === buildOnly(A, { know: KNOW_K1K2, memory: MEM_BASE, files: FILES_SEG, market: marketSeg(A) }),
        `${d1} empty=${okEmpty} other=${other.text === baseB.text} none=${none.text === baseB.text}`];
    });

    // ---------- P41 buildAgentContext (no live caller: characterization only) ----------
    await pres('P41-buildAgentContext-characterization', async () => {
      await setup(A, BASE);
      A.net.log.length = 0;
      const r1 = await A.page.evaluate(async (agent) => { window.__t.labels.length = 0; const t = await NexusContext.buildAgentContext(agent, 'ما سعر الذهب اليوم'); return { t, labels: [...window.__t.labels] }; }, agentFin());
      const exp1 = KNOW_K1K2 + MEM_BASE + '\n\n' + FILES_BODY_RAW + '\n\n' + marketBody(A);
      await setup(A, BASE);
      const r2 = await A.page.evaluate(async (agent) => { window.__t.labels.length = 0; const t = await NexusContext.buildAgentContext(agent, 'ما سعر الذهب اليوم'); return { t, labels: [...window.__t.labels] }; }, agentTechK());
      const exp2 = KNOW_K1K2 + MEM_BASE + '\n\n' + FILES_BODY_RAW;
      return [r1.t === exp1 && same(r1.labels, LABELS_ALL4) && r2.t === exp2 && same(r2.labels, LABELS_3), `${r1.t === exp1 ? 'fin-eq' : diff(r1.t, exp1)} | ${r2.t === exp2 ? 'tech-eq' : diff(r2.t, exp2)}`];
    });

    // ---------- P42 no state mutation ----------
    await pres('P42-baseline-no-state-mutation', async () => {
      await setup(A, BASE);
      const snap = () => A.page.evaluate((keys) => { const o = {}; for (const k of keys) o[k] = PERSISTABLE_STATE[k].get(); return JSON.stringify(o); }, STATE_KEYS);
      const before = await snap();
      const r = await runFull(A, agentFin(), Q);
      const after = await snap();
      return [before === after && r.text === EXP_BASE && STATE_KEYS.length === 14, `keys=${STATE_KEYS.length} equal=${before === after}`];
    });
  } finally {
    await A.ctx.close().catch(() => {});
  }

  // ===================== scenario B: fresh context determinism (V07) =====================
  {
    const B = await newScenario();
    try {
      const ok = await boot(B);
      await valid('V07-determinism-fresh-context', async () => {
        if (!ok) return [false, 'boot failed'];
        await setup(B, BASE);
        const t = await B.page.evaluate(async (agent) => fullAgentPrompt(agent, 'ما سعر الذهب اليوم'), agentFin());
        return [baseHashA !== null && sha(t) === baseHashA, `sha=${sha(t).slice(0, 16)}`];
      });
    } finally { await B.ctx.close().catch(() => {}); }
  }

  await valid('V04b-every-external-request-was-aborted', () => [externalSeen.length >= 1 && externalAborted === externalSeen.length, `attempted=${externalSeen.length} aborted=${externalAborted}`]);
} catch (e) {
  rec('VALID', 'harness-completed-without-crash', false, String((e && e.message) || e).slice(0, 300));
} finally {
  if (browser) await browser.close().catch(() => {});
}

/* ------------------------------ verdict ------------------------------ */
const cnt = (kind, ok) => checks.filter((c) => c.kind === kind && c.ok === ok).length;
const validFail = cnt('VALID', false), presFail = cnt('PRES', false);
const verdict = validFail > 0 ? 'INVALID' : (presFail > 0 ? 'REJECTED' : 'ACCEPTED');
console.log(`\nVALID ${cnt('VALID', true)}/${cnt('VALID', true) + validFail}  PRES ${cnt('PRES', true)}/${cnt('PRES', true) + presFail}  pageErrors=${pageErrors.length}  chromium=${chromiumVersion}`);
console.log(`S11-VERDICT = ${verdict}`);
try { await writeFile(RESULTS_FILE, JSON.stringify({ verdict, chromium: chromiumVersion, frontendDir: path.basename(FRONTEND_DIR), checks }, null, 2)); }
catch (e) { console.log('results file not written: ' + e.message); }
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
