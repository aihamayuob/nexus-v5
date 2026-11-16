// NEXUS — operational scenarios against the BUILT backend (dist/) as a REAL separate OS process, over real HTTP, with an on-disk SQLite DB.
// Models are SIMULATED: a fake Anthropic-protocol "cloud" server and a fake Ollama-protocol "local" server on 127.0.0.1 (no real provider is called).
// What this proves is the NEXUS plumbing (gateway auth, planner/DAG, runner, council, warden, router privacy modes, persistence across a
// hard process kill). It does NOT prove model quality or any real provider/service. Output: PASS/FAIL lines + JSON evidence in $NEXUS_SCENARIO_OUT.
//
// Usage:  (cd src-baseline/nexus-backend && npm ci && npm run build) && node e2e/operational-scenarios.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const BACKEND_DIR = path.resolve(HERE, '../src-baseline/nexus-backend');
const OUT = process.env.NEXUS_SCENARIO_OUT || path.resolve(HERE, '../scenario-out');
mkdirSync(OUT, { recursive: true });
const WORK = mkdtempSync(path.join(tmpdir(), 'nexus-scn-'));
const DB = path.join(WORK, 'nexus.db');
const KEY = 'scn-key-' + 'Zq7Lm2Xv9Tn4Rb8K'; // >=16 chars
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY };

const results = [];
const evidence = {};
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20000, step = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}
function listen(server) {
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res(server.address().port)));
}
async function readBody(req) {
  const c = [];
  for await (const x of req) c.push(x);
  try { return JSON.parse(Buffer.concat(c).toString('utf8') || '{}'); } catch { return {}; }
}

// ---------------- fake "cloud" (Anthropic protocol) ----------------
const cloud = { mode: 'normal', hits: [], tasks: [] }; // mode: normal | fail500 | hang | hang-tasks (planner/verifier answer, task execution hangs)
const cloudSrv = createServer(async (req, res) => {
  if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: [] })); }
  const body = await readBody(req);
  const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system || '');
  const lastUser = JSON.stringify((body.messages || []).slice(-1)[0] || '');
  cloud.hits.push({ t: Date.now(), system: system.slice(0, 40), mode: cloud.mode });
  const isPlanner = system.includes('أنت مخطط مهام'); const isVerifier = system.includes('مراجع مستقل صارم');
  if (cloud.mode === 'hang' || (cloud.mode === 'hang-tasks' && !isPlanner && !isVerifier)) return; // never answers
  if (cloud.mode === 'fail500') { res.writeHead(500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'simulated upstream failure' } })); }
  const reply = (text) => {
    if (body.stream) { // Anthropic SSE framing (the runner streams task output)
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
  if (system.includes('أنت مخطط مهام')) {
    return reply(JSON.stringify({ tasks: [
      { id: 'collect', description: 'TASK-COLLECT اجمع المعطيات', dependsOn: [] },
      { id: 'analyze', description: 'TASK-ANALYZE حلّل المعطيات', dependsOn: ['collect'] },
      { id: 'report', description: 'TASK-REPORT اكتب التقرير النهائي', dependsOn: ['analyze'] },
    ] }));
  }
  if (system.includes('مراجع مستقل صارم')) return reply(JSON.stringify({ verdict: 'ok', issues: [] }));
  const m = /TASK-(COLLECT|ANALYZE|REPORT)/.exec(lastUser);
  if (m) { cloud.tasks.push(m[1]); return reply('نتيجة ' + m[1]); }
  return reply('رد محاكى من السحابة');
});

// ---------------- fake "local" (Ollama protocol) ----------------
const local = { up: true, hits: 0 };
const localSrv = createServer(async (req, res) => {
  if (!local.up) { req.socket.destroy(); return; }
  if (req.url.startsWith('/api/tags')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'fake-local:1b' }] })); }
  await readBody(req);
  local.hits++;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model: 'fake-local:1b', message: { role: 'assistant', content: 'رد محاكى محلي' }, done: true, prompt_eval_count: 3, eval_count: 3 }));
});

// ---------------- backend process management ----------------
let be = null, bePort = 0, beLog = '';
async function startBackend(extraEnv = {}) {
  bePort = 18000 + Math.floor(Math.random() * 1500);
  beLog = '';
  be = spawn(process.execPath, ['--experimental-sqlite', '--enable-source-maps', 'dist/index.js'], {
    cwd: BACKEND_DIR,
    env: {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production',
      NEXUS_HOST: '127.0.0.1', NEXUS_PORT: String(bePort), NEXUS_DB_PATH: DB, NEXUS_GATEWAY_KEYS: KEY, NEXUS_LOG_LEVEL: 'warn',
      NEXUS_ANTHROPIC_BASE_URL: `http://127.0.0.1:${cloudSrv.address().port}`, NEXUS_ANTHROPIC_API_KEY: 'fake-anthropic-key',
      NEXUS_OLLAMA_BASE_URL: `http://127.0.0.1:${localSrv.address().port}`, NEXUS_MODEL_OLLAMA: 'fake-local:1b',
      NEXUS_MAX_RETRIES: '0', NEXUS_RATE_LIMIT_PER_MINUTE: '6000', NEXUS_RATE_LIMIT_BURST: '1000', ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  be.stdout.on('data', (d) => (beLog += d)); be.stderr.on('data', (d) => (beLog += d));
  const ok = await until(async () => { try { return (await fetch(`http://127.0.0.1:${bePort}/v2/health`)).ok; } catch { return false; } }, 15000, 200);
  if (!ok) throw new Error('backend did not start: ' + beLog.slice(0, 500));
}
const URL_ = (p) => `http://127.0.0.1:${bePort}${p}`;
const api = async (method, p, body, headers = AUTH) => {
  const r = await fetch(URL_(p), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, json: j };
};
async function killHard() { if (!be) return; const p = be; be = null; p.kill('SIGKILL'); await new Promise((r) => p.once('exit', r)); }
async function stopSoft() { if (!be) return; const p = be; be = null; p.kill('SIGTERM'); await Promise.race([new Promise((r) => p.once('exit', r)), sleep(5000)]); }

async function pollTask(id, ms = 20000) {
  return until(async () => { const r = await api('GET', `/v2/tasks/${id}`); const t = r.json && r.json.task; return t && ['done', 'failed', 'cancelled'].includes(t.status) ? t : null; }, ms);
}
// POST /v2/tasks is an SSE stream (the connection stays open until the task ends; a client disconnect cancels the task).
async function runTask(input, provider) {
  const r = await fetch(URL_('/v2/tasks'), { method: 'POST', headers: AUTH, body: JSON.stringify({ input, provider }), signal: AbortSignal.timeout(25000) });
  const text = await r.text().catch((e) => 'ABORT:' + e.message);
  const id = /"taskId"\s*:\s*"([^"]+)"/.exec(text)?.[1] || null;
  const task = id ? await pollTask(id, 8000) : null;
  return { httpStatus: r.status, text, taskId: id, task };
}
async function pollMission(id, terminal = ['COMPLETED', 'FAILED', 'CANCELLED'], ms = 25000) {
  return until(async () => { const r = await api('GET', `/v2/missions/${id}`); return r.json && terminal.includes(r.json.state) ? r.json : null; }, ms);
}

// =====================================================================================================
(async () => {
  await Promise.all([listen(cloudSrv), listen(localSrv)]);
  await startBackend();

  // ---- S3a: gateway auth boundary ------------------------------------------------------------------
  {
    const noKey = await api('POST', '/v2/missions', { objective: 'x' }, { 'Content-Type': 'application/json' });
    const badKey = await api('POST', '/v2/missions', { objective: 'x' }, { 'Content-Type': 'application/json', Authorization: 'Bearer nope-nope-nope-nope' });
    const embedNoKey = await api('POST', '/api/embed', { texts: ['x'] }, { 'Content-Type': 'application/json' });
    check('S3a unauthenticated mission request is rejected (401)', noKey.status === 401, noKey.status);
    check('S3a wrong key rejected (401)', badKey.status === 401, badKey.status);
    check('S3a F-01: /api/embed without key rejected (401) on the BUILT backend', embedNoKey.status === 401, embedNoKey.status);
    check('S3a no cloud/local model call happened for the rejected requests', cloud.hits.length === 0 && local.hits === 0, `cloud=${cloud.hits.length} local=${local.hits}`);
  }

  // ---- S1: multi-step mission (planner -> DAG -> ordered execution -> verified result -> audited transitions)
  let s1MissionId;
  {
    const c = await api('POST', '/v2/missions', { objective: 'أعدّ تقريرًا من ثلاث مراحل: جمع، تحليل، كتابة' });
    check('S1 mission accepted asynchronously (202 + id)', c.status === 202 && !!c.json?.missionId, c.status);
    s1MissionId = c.json?.missionId;
    const m = await pollMission(s1MissionId);
    evidence.s1Mission = m;
    check('S1 mission reaches COMPLETED', m?.state === 'COMPLETED', m?.state);
    check('S1 final output present', !!m?.result?.finalOutput, JSON.stringify(m?.result || {}).slice(0, 120));
    const order = cloud.tasks.filter((x, i, a) => i === 0 || a[i - 1] !== x).join('>'); // each task issues 2 provider calls; compare the first-occurrence order
    check('S1 tasks ran in dependency order collect>analyze>report', order === 'COLLECT>ANALYZE>REPORT', order);
    const tr = await api('GET', `/v2/missions/${s1MissionId}/transitions`);
    const states = (tr.json?.transitions || []).map((t) => t.toState);
    evidence.s1Transitions = states;
    check('S1 audited transition history starts PLANNING and ends COMPLETED', states[0] === 'PLANNING' && states[states.length - 1] === 'COMPLETED', states.join('>'));
  }

  // ---- S2: council (two roles, multi-round) ---------------------------------------------------------
  let s2SessionId;
  {
    const c = await api('POST', '/v2/council', { topic: 'هل نطلق الميزة الآن؟', proposerAgentId: 'financial', criticAgentId: 'legal' });
    s2SessionId = c.json?.sessionId;
    const s = await until(async () => { const r = await api('GET', `/v2/council/${s2SessionId}`); return r.json && ['COMPLETED', 'FAILED'].includes(r.json.state) ? r.json : null; });
    check('S2 council session reaches COMPLETED', s?.state === 'COMPLETED', s?.state);
    const rr = await api('GET', `/v2/council/${s2SessionId}/rounds`);
    const rounds = rr.json?.rounds || [];
    evidence.s2Rounds = rounds.map((r) => ({ kind: r.kind, agentId: r.agentId }));
    check('S2 five rounds recorded', rounds.length === 5, rounds.length);
    const agents = new Set(rounds.map((r) => r.agentId));
    check('S2 more than one distinct agent participated (not one model talking to itself under one role)', agents.size >= 2, [...agents].join(','));
    check('S2 round kinds are distinct protocol phases', new Set(rounds.map((r) => r.kind)).size >= 3, rounds.map((r) => r.kind).join(','));
  }

  // ---- S5: routing privacy modes + provider failure ---------------------------------------------------
  {
    const r = await api('POST', '/v2/route', { mode: 'LOCAL_ONLY' });
    evidence.s5Route = r.json;
    check('S5 LOCAL_ONLY routes to the local provider with cloud fallback blocked', r.status === 200 && r.json?.provider === 'ollama' && r.json?.cloudFallbackBlocked === true, JSON.stringify(r.json).slice(0, 200));
    const cloudBefore = cloud.hits.length;
    const okRun = await runTask('سؤال محلي', 'ollama');
    const t = okRun.task; evidence.s5LocalTaskStream = okRun.text.slice(0, 600);
    evidence.s5LocalTask = t;
    check('S5 local task completes (done) on the local (simulated) model, zero cloud requests', t?.status === 'done' && local.hits >= 1 && cloud.hits.length === cloudBefore, `status=${t?.status} local=${local.hits} cloudDelta=${cloud.hits.length - cloudBefore}`);

    // local provider goes DOWN: error, never a silent cloud fallback
    local.up = false;
    const cloudB2 = cloud.hits.length;
    const downRun = await runTask('سؤال محلي والمحلي متوقف', 'ollama');
    const dt = downRun.task; evidence.s5LocalDownStream = downRun.text.slice(0, 600);
    evidence.s5LocalDownTask = dt;
    const st = dt && dt.status;
    check('S5 local provider down => task ends FAILED (honest error), not completed', st === 'failed', st);
    check('S5 local provider down => zero requests reached the cloud (no privacy-violating fallback)', cloud.hits.length === cloudB2, `cloudDelta=${cloud.hits.length - cloudB2}`);
    local.up = true;

    // cloud provider fails (500): with a healthy local fallback the router switches provider and the user gets a real answer from it
    cloud.mode = 'fail500';
    const cloudB3 = cloud.hits.length, localB3 = local.hits;
    const badRun = await runTask('سؤال سحابي والمزود يفشل', 'anthropic');
    const bt = badRun.task; evidence.s5CloudFailStream = badRun.text.slice(0, 600);
    check('S5 cloud 5xx + healthy local provider => the request was attempted on the cloud, then SAFELY switched to the local provider and completed', bt?.status === 'done' && cloud.hits.length > cloudB3 && local.hits === localB3 + 1 && /رد محاكى محلي/.test(badRun.text), `status=${bt?.status} cloudAttempts=${cloud.hits.length - cloudB3} localHits=${local.hits - localB3}`);
    // OBSERVATION recorded (not asserted): the task row keeps the REQUESTED provider; the serving provider is not on the row.
    evidence.OBS_taskRowProviderAfterFallback = bt?.provider;
    // every provider down => honest FAILED, never a fabricated answer
    local.up = false;
    const allDown = await runTask('سؤال والجميع متوقف', 'anthropic');
    check('S5 cloud 5xx AND local down => task ends FAILED with no fabricated answer', allDown.task?.status === 'failed' && !/"type":"token"/.test(allDown.text), `status=${allDown.task?.status}`);
    local.up = true;
    cloud.mode = 'normal';
  }

  // ---- S3b: Warden isolation ---------------------------------------------------------------------------
  {
    const iso = await api('POST', '/v2/warden/agents/financial/isolate', { reason: 'scenario: policy breach suspected' });
    check('S3b agent isolation accepted', iso.status === 200 || iso.status === 202, iso.status);
    const list = await api('GET', '/v2/warden/agents/isolated');
    evidence.s3bIsolated = list.json;
    check('S3b isolated agent listed', JSON.stringify(list.json).includes('financial'), JSON.stringify(list.json).slice(0, 160));
    const c = await api('POST', '/v2/council', { topic: 'جلسة بوكيل معزول', proposerAgentId: 'financial', criticAgentId: 'legal' });
    let outcome = c.status;
    if (c.json?.sessionId) {
      const s = await until(async () => { const r = await api('GET', `/v2/council/${c.json.sessionId}`); return r.json && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(r.json.state) ? r.json : null; }, 15000);
      outcome = s?.state;
    }
    evidence.s3bIsolatedCouncilOutcome = outcome;
    check('S3b an isolated agent cannot complete a council session (rejected or FAILED, never COMPLETED)', outcome !== 'COMPLETED', String(outcome));
    const de = await api('POST', '/v2/warden/agents/financial/deisolate', {});
    check('S3b de-isolation accepted', de.status === 200 || de.status === 202, de.status);
  }

  // ---- S7: stall + cancel ends honestly -------------------------------------------------------------------
  {
    cloud.mode = 'hang';
    const c = await api('POST', '/v2/missions', { objective: 'مهمة ستتعطل لأن المزود لا يرد' });
    await sleep(500);
    const cancel = await api('POST', `/v2/missions/${c.json.missionId}/cancel`, { reason: 'scenario cancel' });
    check('S7 cancel of a stalled mission accepted (202)', cancel.status === 202, cancel.status);
    const m = await pollMission(c.json.missionId, ['COMPLETED', 'FAILED', 'CANCELLED'], 15000);
    evidence.s7Cancelled = m && { state: m.state };
    check('S7 stalled+cancelled mission ends CANCELLED (never COMPLETED)', m?.state === 'CANCELLED', m?.state);
    cloud.mode = 'normal';
  }

  // ---- S8: MCP server (JSON-RPC over HTTP) on the real built backend ------------------------------------------------
  {
    const rpc = (body, h = AUTH) => api('POST', '/mcp', body, h);
    const noAuth = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'Content-Type': 'application/json' });
    check('S8 MCP without Bearer is rejected (401)', noAuth.status === 401, noAuth.status);
    const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'scenario', version: '1' } } });
    check('S8 MCP initialize returns serverInfo.name=nexus and tools capability only', init.json?.result?.serverInfo?.name === 'nexus' && Object.keys(init.json?.result?.capabilities ?? {}).join() === 'tools', JSON.stringify(init.json?.result?.capabilities));
    const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (list.json?.result?.tools ?? []).map((t) => t.name);
    check('S8 MCP tools/list exposes calculate and NOT web_fetch (egress) by default', names.includes('calculate') && !names.includes('web_fetch'), names.join());
    const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'calculate', arguments: { expression: '6*7' } } });
    check('S8 MCP tools/call calculate returns 42 through the real tool pipeline', call.json?.result?.isError === false && /42/.test(call.json?.result?.content?.[0]?.text ?? ''), JSON.stringify(call.json?.result));
    const wf = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'web_fetch', arguments: { url: 'http://127.0.0.1:1/' } } });
    check('S8 MCP tools/call web_fetch is refused (-32602) and never executes', wf.json?.error?.code === -32602, JSON.stringify(wf.json));
    evidence.s8Mcp = { tools: names };
  }

  // ---- S6: restart persistence across a HARD kill -------------------------------------------------------------------
  let planningCrashId = null;
  {
    const before = (await api('GET', `/v2/missions/${s1MissionId}`)).json;
    const councilBefore = (await api('GET', `/v2/council/${s2SessionId}/rounds`)).json;
    // (a) crash while tasks are RUNNING (planner answered, provider hangs on task execution)
    cloud.mode = 'hang-tasks';
    const runningM = await api('POST', '/v2/missions', { objective: 'مهمة جارية (مرحلة التنفيذ) وقت الانهيار' });
    const runningId = runningM.json.missionId;
    // (b) crash while still PLANNING (provider hangs everything) — a second mission
    await until(async () => { const r = (await api('GET', `/v2/missions/${runningId}`)).json; return r && r.state === 'RUNNING'; }, 8000, 100);
    cloud.mode = 'hang';
    const planningM = await api('POST', '/v2/missions', { objective: 'مهمة في مرحلة التخطيط وقت الانهيار' });
    planningCrashId = planningM.json.missionId;
    await sleep(500);
    const preRunning = (await api('GET', `/v2/missions/${runningId}`)).json;
    const prePlanning = (await api('GET', `/v2/missions/${planningCrashId}`)).json;
    check('S6 (a) mission was RUNNING (non-terminal) at crash time', preRunning?.state === 'RUNNING', preRunning?.state);
    check('S6 (b) mission was PLANNING (non-terminal) at crash time', prePlanning?.state === 'PLANNING', prePlanning?.state);
    await killHard(); // SIGKILL: no graceful shutdown, no chance to flush anything
    cloud.mode = 'normal';
    const cloudHitsAtRestart = cloud.hits.length;
    await startBackend();
    const after = (await api('GET', `/v2/missions/${s1MissionId}`)).json;
    const councilAfter = (await api('GET', `/v2/council/${s2SessionId}/rounds`)).json;
    check('S6 completed mission is identical after SIGKILL + restart (state + final output)', after?.state === 'COMPLETED' && after?.result?.finalOutput === before?.result?.finalOutput, after?.state);
    check('S6 council rounds survive restart (5 rounds, same outputs)', councilAfter?.rounds?.length === 5 && JSON.stringify(councilAfter.rounds.map((r) => r.output)) === JSON.stringify(councilBefore.rounds.map((r) => r.output)), councilAfter?.rounds?.length);
    const fin = await pollMission(runningId, ['COMPLETED', 'FAILED', 'CANCELLED'], 30000);
    evidence.s6RunningCrashFinal = fin && { state: fin.state, finalOutput: fin.result?.finalOutput };
    check('S6 (a) mission interrupted mid-RUNNING is resumed after restart and reaches COMPLETED', fin?.state === 'COMPLETED', fin?.state);
    check('S6 (a) the resumed mission was really re-executed (new provider requests after restart, not a fabricated completion)', cloud.hits.length > cloudHitsAtRestart, `newCloudHits=${cloud.hits.length - cloudHitsAtRestart}`);
    await sleep(1500);
    const planAfter = (await api('GET', `/v2/missions/${planningCrashId}`)).json;
    evidence.s6PlanningCrashAfterRestart = planAfter && { state: planAfter.state };
    check('S6 (b) mission killed while PLANNING is never reported COMPLETED after restart', planAfter && planAfter.state !== 'COMPLETED', planAfter?.state);
    // FINDING (recorded, not asserted as success): see report — whether a planning-phase orphan ever reaches a terminal state without manual action.
    evidence.FINDING_planningOrphanTerminal = !!planAfter && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(planAfter.state);
    console.log(`[INFO] S6 (b) planning-phase orphan state after restart + 1.5s: ${planAfter?.state} (terminal=${evidence.FINDING_planningOrphanTerminal})`);
    // F-03 (2026-11-16): the finding above is now a requirement — a REAL SIGKILL during PLANNING must end FAILED (terminal, explicit reason), not stay PLANNING forever.
    check('S6 (b) F-03: mission killed while PLANNING reaches terminal FAILED after restart (real SIGKILL)', planAfter?.state === 'FAILED', planAfter?.state);
  }

  // ---- S3c: warden status snapshot is coherent -----------------------------------------------------------------------
  {
    const w = await api('GET', '/v2/warden/status');
    evidence.wardenStatus = w.json;
    check('S3c warden status snapshot is well-formed', w.status === 200 && typeof w.json?.activeMissions === 'number' && typeof w.json?.pendingApprovals === 'number', JSON.stringify(w.json).slice(0, 200));
    console.log(`[INFO] S3c activeMissions=${w.json?.activeMissions} (planning-phase orphan counted as active: ${evidence.FINDING_planningOrphanTerminal === false})`);
  }
})()
  .catch((e) => { check('HARNESS no uncaught exception', false, e && e.stack || e); })
  .finally(async () => {
    await stopSoft().catch(() => {});
    cloudSrv.closeAllConnections?.(); localSrv.closeAllConnections?.(); cloudSrv.close(); localSrv.close();
    writeFileSync(path.join(OUT, 'operational-scenarios-results.json'), JSON.stringify({ ranAt: new Date().toISOString(), node: process.version, results, evidence, simulated: ['anthropic-protocol fake cloud', 'ollama-protocol fake local'], backendLogTail: beLog.slice(-1500) }, null, 2));
    const fails = results.filter((r) => !r.ok).length;
    console.log(`SUMMARY ${results.length - fails}/${results.length} passed; evidence -> ${path.join(OUT, 'operational-scenarios-results.json')}`);
    console.log(fails === 0 ? 'OPERATIONAL-SCENARIOS-VERDICT = ACCEPTED (simulated models)' : 'OPERATIONAL-SCENARIOS-VERDICT = REJECTED');
    try { rmSync(WORK, { recursive: true, force: true }); } catch { /* ignore */ }
    process.exit(fails === 0 ? 0 : 1);
  });
