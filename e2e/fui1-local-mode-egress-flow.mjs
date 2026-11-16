/* ==========================================================================
   e2e/fui1-local-mode-egress-flow.mjs — F-UI-1: with a LOCAL chat model selected (the state the "🔒 محلي" badge describes:
   "this conversation is processed entirely on your device/LAN — nothing is sent to any external server"), NO user text may reach a CLOUD provider
   on ANY frontend path: simple mode (Smart Auto-Route manager), advanced mode (auto-route / deep analysis verifier), ask-team picker,
   multi-model consensus, embeddings (/api/embed), local provider failing (503) and local provider absent (connection refused).
   Real Chromium loads the REAL frontend; the REAL backend process (src/index.ts via tsx) serves it. Providers are FAKES:
     - a working fake "ollama" (chat + stream + embed) — proves wiring only, NOT a real Ollama;
     - a metering fake CLOUD that stands in for Anthropic (/v1/messages) AND OpenAI (/v1/embeddings, /v1/chat/completions); every request is logged.
   VALID = the harness is trustworthy (meter live; non-local control DOES reach the cloud; the manager path is really exercised).
   PS    = product behaviour (what F-UI-1 requires). Final line: FUI1-VERDICT = ACCEPTED | REJECTED | INVALID. Exit 0 iff ACCEPTED.
   Honest limits: fake providers only; paths not driven here are listed in the report as UNVERIFIED.
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(HERE, '../frontend');
const BACKEND_DIR = path.resolve(HERE, '../src-baseline/nexus-backend');
const RESULTS_FILE = process.env.NEXUS_FUI1_RESULTS || path.join(os.tmpdir(), 'fui1-results.json');
const HTML_FILE = 'neural_nexus_ai_agents-4-3-5-3.html';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const KEY = 'LAN-e2e-key-Qw8Zr3Lm5Xv7Tn2B-0001';
const MARK = 'CONFIDENTIAL-fui1-9d42'; // every scenario uses MARK + a scenario suffix so a leaked body is attributable

const checks = [];
function rec(kind, name, ok, detail) { checks.push({ kind, name, ok: !!ok, detail: detail ?? null }); console.log(`[${ok ? 'PASS' : 'FAIL'}] [${kind}] ${name}${detail ? ' — ' + detail : ''}`); }
const valid = (n, ok, d) => rec('VALID', n, ok, d);
const ps = (n, ok, d) => rec('PS', n, ok, d);

const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const canConnect = (port) => new Promise((res) => { const c = net.connect({ port, host: '127.0.0.1' }); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
const listen = (s, port) => new Promise((r) => s.listen(port, '127.0.0.1', r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- fakes ---------------------------------------------------------------------------------------------------------------------------------
const localLog = []; // every request the fake LOCAL provider received
let localMode = 'ok'; // 'ok' | 'fail503'
const readBody = async (req) => { const c = []; for await (const x of req) c.push(x); return Buffer.concat(c).toString('utf8'); };
const fakeLocal = http.createServer(async (req, res) => {
  const body = await readBody(req);
  localLog.push({ url: req.url, hasMark: body.includes(MARK) });
  if (localMode === 'fail503') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'local model server down' })); }
  let parsed = {}; try { parsed = JSON.parse(body); } catch { /* ignore */ }
  if (req.url === '/api/embed') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ embeddings: (parsed.input || []).map(() => [0.1, 0.2, 0.3]) })); }
  if (parsed.stream) {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(JSON.stringify({ message: { content: 'local answer' }, done: false }) + '\n');
    return res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 3, eval_count: 3 }) + '\n');
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ message: { content: '{"agent_ids":["general"],"reason":"local manager"}' }, prompt_eval_count: 3, eval_count: 3 }));
});

const cloudLog = []; // every request the fake CLOUD received (the egress meter)
const fakeCloud = http.createServer(async (req, res) => {
  const body = await readBody(req);
  cloudLog.push({ url: req.url, hasMark: body.includes(MARK), bytes: body.length });
  res.writeHead(200, { 'content-type': 'application/json' });
  if (req.url.includes('embeddings')) return res.end(JSON.stringify({ data: [{ index: 0, embedding: [0.9, 0.8, 0.7] }] }));
  if (req.url.includes('chat/completions')) return res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'cloud answered' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 3 } }));
  res.end(JSON.stringify({ content: [{ type: 'text', text: '{"agent_ids":["general"],"reason":"cloud manager"}' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }));
});

const fePort = await freePort(); const bePort = await freePort(); const localPort = await freePort(); const cloudPort = await freePort();
const feOrigin = `http://127.0.0.1:${fePort}`; const beOrigin = `http://127.0.0.1:${bePort}`;
await listen(fakeLocal, localPort); await listen(fakeCloud, cloudPort);

const feServer = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const rel = u.pathname === '/' ? HTML_FILE : decodeURIComponent(u.pathname.slice(1));
  const abs = path.resolve(FRONTEND_DIR, rel);
  if (!abs.startsWith(FRONTEND_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(abs); res.writeHead(200, { 'content-type': MIME[path.extname(rel)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(b); }
  catch { res.writeHead(404); res.end('nf'); }
});
await listen(feServer, fePort);

let out = '';
const cloudBase = `http://127.0.0.1:${cloudPort}`;
const be = spawn(path.join(BACKEND_DIR, 'node_modules/.bin/tsx'), ['src/index.ts'], {
  cwd: BACKEND_DIR,
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXUS_DB_PATH: ':memory:', NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(bePort), NEXUS_GATEWAY_KEYS: KEY,
    NEXUS_CORS_ORIGINS: feOrigin, NEXUS_LOG_LEVEL: 'warn', NEXUS_RATE_LIMIT_PER_MINUTE: '3000', NEXUS_RATE_LIMIT_BURST: '500', NEXUS_MAX_RETRIES: '0',
    NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${localPort}`, NEXUS_MODEL_OLLAMA: 'llama3.1',
    NEXUS_ANTHROPIC_BASE_URL: cloudBase, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key',
    NEXUS_OPENAI_BASE_URL: cloudBase, NEXUS_OPENAI_API_KEY: 'fake-openai-key' }, // an embeddings-capable CLOUD provider is configured on the backend
  stdio: ['ignore', 'pipe', 'pipe'],
});
be.stdout.on('data', (d) => (out += d)); be.stderr.on('data', (d) => (out += d));
let up = false;
for (let i = 0; i < 300 && !up; i++) { up = await canConnect(bePort); if (!up) await sleep(100); }
valid('V1 the real backend process started and listens', up, up ? null : out.slice(0, 300));

const browser = await chromium.launch();
const pageErrors = [];
async function freshPage() {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(feOrigin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof encryptionKey !== 'undefined' && encryptionKey !== null, null, { timeout: 15000 });
  await page.evaluate(() => openSettingsPanel());
  await page.fill('#backendUrlInput', beOrigin);
  await page.fill('#gatewayKeyInput', KEY);
  await page.click('button[onclick="saveBackendUrl()"]');
  await page.evaluate(() => { localStorage.setItem('nexus_local_model_name', 'llama3.1'); localStorage.setItem('nexus_providers', JSON.stringify(['openai'])); });
  return { ctx, page };
}
/** Select the chat model through the REAL control path (advanced-mode select → saveChatModelSetting) and set the UI mode. */
async function setMode(page, { model, simple }) {
  await page.evaluate(({ model, simple }) => {
    if (isSimpleMode() !== simple) toggleSimpleMode(); // advanced-only controls are hidden in simple mode, so select the model first (in advanced) then switch
    const sel = document.getElementById('chatModelSelect'); sel.value = model; saveChatModelSetting();
    if (isSimpleMode() !== simple) toggleSimpleMode();
    updateSovereigntyBadge();
  }, { model, simple });
}
async function setToggles(page, on) { // on: {autoRouteToggle:true, deepAnalysisToggle:false, ...}
  await page.evaluate((on) => { for (const [id, v] of Object.entries(on)) { const el = document.getElementById(id); if (el) { el.checked = v; el.dispatchEvent(new Event('change', { bubbles: true })); } } }, on);
}
/** Send through the REAL UI (textarea + send button) and wait for the send lock to release. */
async function sendViaUi(page, text) {
  await page.fill('#msgInput', text);
  await page.click('#sendBtn');
  await page.waitForFunction(() => !isSendingMessage && !document.getElementById('sendBtn').disabled, null, { timeout: 60000 }).catch(() => {});
  await sleep(300);
}
const snap = () => ({ c: cloudLog.length, l: localLog.length });
const since = (s) => ({ cloud: cloudLog.slice(s.c), local: localLog.slice(s.l) });
const leaks = (d) => `cloud requests=${d.cloud.length} (with marker=${d.cloud.filter((x) => x.hasMark).length}) [${d.cloud.map((x) => x.url).join(',')}]; local requests=${d.local.length}`;

try {
  const auth = { 'content-type': 'application/json', Authorization: 'Bearer ' + KEY };

  // ---- VALID controls independent of the browser ---------------------------------------------------------------------------------------
  let s0 = snap();
  const ctlCloud = await fetch(beOrigin + '/api/chat', { method: 'POST', headers: auth, body: JSON.stringify({ provider: 'anthropic', max_tokens: 20, messages: [{ role: 'user', content: MARK + '-ctl' }] }) });
  valid('V2 control: the cloud egress meter is live (explicit cloud request registers WITH the marker)', ctlCloud.status === 200 && since(s0).cloud.length === 1 && since(s0).cloud[0].hasMark, `${ctlCloud.status} ${leaks(since(s0))}`);
  s0 = snap();
  // F-01: /api/embed is authenticated now; the control must carry the key to still exercise the leak mechanism
  const ctlEmbed = await fetch(beOrigin + '/api/embed', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY }, body: JSON.stringify({ texts: [MARK + '-embctl'] }) });
  valid('V3 control: backend /api/embed WITHOUT any local-only hint routes to the configured CLOUD embeddings provider (the leak mechanism exists)', ctlEmbed.status === 200 && since(s0).cloud.some((x) => x.url.includes('embeddings') && x.hasMark), `${ctlEmbed.status} ${leaks(since(s0))}`);

  // ---- NON-LOCAL control through the real UI: simple mode + Claude → the manager call reaches the cloud (by design when NOT local) -------
  {
    const { ctx, page } = await freshPage();
    await setMode(page, { model: 'anthropic', simple: true });
    const route = await page.evaluate((t) => HierarchicalRouter.route(t, {}).fastPathEligible, MARK + '-ctlui hello');
    valid('V4 the manager-LLM path is really exercised: the heuristic fast path is NOT eligible for the scenario text', route === false, `fastPathEligible=${route}`);
    const s = snap(); await sendViaUi(page, MARK + '-ctlui hello');
    const d = since(s);
    valid('V5 control (NON-local, Claude selected): the same UI flow registers on the cloud meter with the marker', d.cloud.some((x) => x.hasMark), leaks(d));
    await ctx.close();
  }

  // ---- PS scenarios: LOCAL chat model selected ------------------------------------------------------------------------------------------
  const { ctx, page } = await freshPage();
  await setMode(page, { model: 'ollama', simple: true });
  const badge = await page.evaluate(() => ({ chat: getChatModel(), shown: getComputedStyle(document.getElementById('sovereigntyBadge')).display !== 'none' }));
  valid('V6 the local state is really active through the real select path (chat model = ollama, sovereignty badge shown)', badge.chat === 'ollama' && badge.shown, JSON.stringify(badge));

  // A) simple mode + smart manager (Smart Auto-Route is implicit in simple mode)
  let s = snap(); await sendViaUi(page, MARK + '-A simple');
  let d = since(s);
  ps('A1 SIMPLE mode + smart manager, local up: zero cloud requests (manager must not call the cloud)', d.cloud.length === 0, leaks(d));
  ps('A2 SIMPLE mode: the work really ran locally (the local provider received requests)', d.local.length >= 1, leaks(d));

  // B) advanced mode + auto-route toggle
  await setMode(page, { model: 'ollama', simple: false });
  await setToggles(page, { autoRouteToggle: true, deepAnalysisToggle: false, multiModelToggle: false, collectiveToggle: false });
  s = snap(); await sendViaUi(page, MARK + '-B advanced-autoroute');
  d = since(s);
  ps('B1 ADVANCED mode + auto-route, local up: zero cloud requests', d.cloud.length === 0, leaks(d));

  // C) advanced mode + deep analysis (the independent Verifier step)
  await setToggles(page, { autoRouteToggle: false, deepAnalysisToggle: true });
  s = snap(); await sendViaUi(page, MARK + '-C deep');
  d = since(s);
  ps('C1 ADVANCED deep analysis, local up: zero cloud requests', d.cloud.length === 0, leaks(d));
  // C2/C3: the independent Verifier is intent-gated (risk/complexity high) so C1 may not reach it — exercise it directly AND through a high-risk message.
  s = snap();
  const verdictDirect = await page.evaluate((t) => Verifier.verify(t, 'draft answer'), MARK + '-C2 verifier-direct');
  d = since(s);
  ps('C2 Verifier.verify() called directly while LOCAL is selected: zero cloud requests AND it really ran on the local model (ok:true, local request seen)', d.cloud.length === 0 && verdictDirect.ok === true && d.local.length >= 1, leaks(d) + ' result=' + JSON.stringify(verdictDirect).slice(0, 80));
  const risky = await page.evaluate((t) => ({ shouldVerify: Verifier.shouldVerify(NexusIntentEngine.analyze(t, {})) }), MARK + '-C3 ما هي جرعة الدواء');
  valid('V7 the high-risk scenario text really makes the Verifier eligible (so C3 exercises it)', risky.shouldVerify === true, JSON.stringify(risky));
  s = snap(); await sendViaUi(page, MARK + '-C3 ما هي جرعة الدواء');
  d = since(s);
  ps('C3 ADVANCED deep analysis on a HIGH-RISK message (Verifier eligible), local up: zero cloud requests', d.cloud.length === 0, leaks(d));
  await setToggles(page, { deepAnalysisToggle: false, autoRouteToggle: true });

  // D) ask-team picker (smart manager for Compare/Challenge/Decide)
  s = snap();
  const picked = await page.evaluate((t) => pickAskTeam(t, 2, 3), MARK + '-D askteam');
  d = since(s);
  ps('D1 ask-team picker (smart manager), local up: zero cloud requests AND it really ran on the local model (a local request seen, ids returned)', d.cloud.length === 0 && d.local.length >= 1 && Array.isArray(picked) && picked.length >= 2, leaks(d) + ' picked=' + JSON.stringify(picked));

  // E) multi-model consensus with an extra (cloud) provider enabled
  await setToggles(page, { autoRouteToggle: false, multiModelToggle: true });
  s = snap(); await sendViaUi(page, MARK + '-E multimodel');
  d = since(s);
  ps('E1 multi-model consensus while LOCAL is selected: zero cloud requests (fail closed, cloud providers excluded)', d.cloud.length === 0, leaks(d));
  const eMsg = await page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
  ps('E2 multi-model in local mode tells the user why it is unavailable instead of silently doing nothing/sending', /توافق متعدد النماذج/.test(eMsg) && /محلي/.test(eMsg), eMsg.slice(0, 160));
  await setToggles(page, { multiModelToggle: false, autoRouteToggle: true });

  // F) embeddings (knowledge / long-term memory / neural history all call getEmbedding)
  s = snap();
  const emb = await page.evaluate(async (t) => { try { const v = await getEmbedding(t); return { ok: true, len: v.length }; } catch (e) { return { ok: false, msg: String(e && e.message).slice(0, 160) }; } }, MARK + '-F embed');
  d = since(s);
  ps('F1 getEmbedding() while LOCAL is selected: zero cloud requests (no cloud embeddings provider used)', d.cloud.length === 0, leaks(d) + ' result=' + JSON.stringify(emb));
  // F-01: the backend /api/embed route is authenticated (gateway keys are configured here), so a SUCCESSFUL local embedding proves the frontend sent the Bearer key.
  ps('F1b F-01: getEmbedding() SUCCEEDS against the key-protected backend /api/embed (the frontend sends the gateway key) and reached the LOCAL provider', emb.ok === true && emb.len === 3 && d.local.length >= 1, 'result=' + JSON.stringify(emb) + ' localHits=' + d.local.length);

  // L) the central choke point: an EXPLICIT cloud provider requested while local mode is active must be refused before any network use (defence in depth
  //    for every present and future caller that names a provider), including the streamed and parallel wrappers.
  s = snap();
  const explicit = await page.evaluate(async (t) => {
    const r = {};
    try { await callClaude('system', t + '-L1', [], 'anthropic', false, null, null); r.direct = 'RESOLVED'; } catch (e) { r.direct = e.name; }
    try { await callClaudeStreamed('system', t + '-L2', [], 'x', 'openai'); r.streamed = 'RESOLVED'; } catch (e) { r.streamed = e.name; }
    const par = await callClaudeStreamedParallel([{ label: 'x', prompt: 'system', input: t + '-L3', history: [], provider: 'gemini' }]);
    r.parallel = par[0].status === 'rejected' ? par[0].reason.name : 'RESOLVED';
    return r;
  }, MARK);
  d = since(s);
  ps('L1 an explicit cloud provider while LOCAL is active is refused by the choke point (direct / streamed / parallel) and sends nothing', d.cloud.length === 0 && explicit.direct === 'LocalOnlyEgressBlocked' && explicit.streamed === 'LocalOnlyEgressBlocked' && explicit.parallel === 'LocalOnlyEgressBlocked', leaks(d) + ' ' + JSON.stringify(explicit));

  // J) every other advanced-mode toggle, one at a time, through the real UI (collective, situation room, cross-examination, mirror, agent runtime, sandbox, tools)
  const ALL_TOGGLES = ['collectiveToggle', 'situationRoomToggle', 'autoRouteToggle', 'deepAnalysisToggle', 'multiModelToggle', 'toolsToggle', 'crossExamToggle', 'mirrorModeToggle', 'sandboxToggle', 'agentRuntimeToggle'];
  for (const [i, tg] of ['collectiveToggle', 'situationRoomToggle', 'crossExamToggle', 'mirrorModeToggle', 'agentRuntimeToggle', 'sandboxToggle', 'toolsToggle'].entries()) {
    await setToggles(page, Object.fromEntries(ALL_TOGGLES.map((id) => [id, id === tg])));
    s = snap(); await sendViaUi(page, `${MARK}-J${i} ${tg}`);
    d = since(s);
    ps(`J${i + 1} ADVANCED mode "${tg}", local up: zero cloud requests`, d.cloud.length === 0, leaks(d));
  }
  await setToggles(page, Object.fromEntries(ALL_TOGGLES.map((id) => [id, id === 'autoRouteToggle'])));

  // K) SIMPLE mode "ask the team" modes (compare / challenge / decide) — each starts with the smart team picker
  await setMode(page, { model: 'ollama', simple: true });
  for (const [i, am] of ['compare', 'challenge', 'decide'].entries()) {
    await page.evaluate((m) => setAskMode(m), am);
    s = snap(); await sendViaUi(page, `${MARK}-K${i} ask-${am}`);
    d = since(s);
    ps(`K${i + 1} SIMPLE mode ask-team "${am}", local up: zero cloud requests`, d.cloud.length === 0, leaks(d));
  }
  await page.evaluate(() => setAskMode('analyze'));
  await setMode(page, { model: 'ollama', simple: true });

  // G) local provider FAILING (503): fail closed — no cloud fallback of any kind
  localMode = 'fail503';
  await setMode(page, { model: 'ollama', simple: true });
  s = snap(); await sendViaUi(page, MARK + '-G local503');
  d = since(s);
  ps('G1 local provider returns 503 (SIMPLE mode): zero cloud requests (no automatic cloud fallback)', d.cloud.length === 0, leaks(d));
  await setMode(page, { model: 'ollama', simple: false });
  await setToggles(page, { autoRouteToggle: true });
  s = snap(); await sendViaUi(page, MARK + '-G2 local503-adv');
  d = since(s);
  ps('G2 local provider returns 503 (ADVANCED auto-route): zero cloud requests', d.cloud.length === 0, leaks(d));
  const gMsg = await page.evaluate(() => (messages[messages.length - 1] || {}).content || '');
  ps('G3 the user sees an error (never a false success) when the local provider fails', /فشل|تعذر|خطأ|503|محلي/.test(gMsg), gMsg.slice(0, 160));

  // H) local provider ABSENT (connection refused)
  localMode = 'ok'; fakeLocal.close(); fakeLocal.closeAllConnections?.(); await sleep(300);
  await setMode(page, { model: 'ollama', simple: true });
  s = snap(); await sendViaUi(page, MARK + '-H local-absent');
  d = since(s);
  ps('H1 local provider ABSENT (SIMPLE mode): zero cloud requests', d.cloud.length === 0, leaks(d));
  await setMode(page, { model: 'ollama', simple: false });
  s = snap(); await sendViaUi(page, MARK + '-H2 local-absent-adv');
  d = since(s);
  ps('H2 local provider ABSENT (ADVANCED auto-route): zero cloud requests', d.cloud.length === 0, leaks(d));

  // overall
  ps('Z1 no uncaught page errors during the local-mode scenarios', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 200));
  await ctx.close();
} finally {
  await browser.close();
  be.kill('SIGTERM'); await sleep(1500); be.kill('SIGKILL');
  feServer.close(); feServer.closeAllConnections?.(); try { fakeLocal.close(); } catch { /* already closed */ } fakeCloud.close();
}

const vFail = checks.filter((c) => c.kind === 'VALID' && !c.ok); const pFail = checks.filter((c) => c.kind === 'PS' && !c.ok);
const verdict = vFail.length ? 'INVALID' : pFail.length ? 'REJECTED' : 'ACCEPTED';
console.log(`SUMMARY VALID ${checks.filter((c) => c.kind === 'VALID' && c.ok).length}/${checks.filter((c) => c.kind === 'VALID').length}  PS ${checks.filter((c) => c.kind === 'PS' && c.ok).length}/${checks.filter((c) => c.kind === 'PS').length}`);
console.log(`FUI1-VERDICT = ${verdict}`);
await writeFile(RESULTS_FILE, JSON.stringify({ verdict, checks }, null, 2));
process.exit(verdict === 'ACCEPTED' ? 0 : 1);
