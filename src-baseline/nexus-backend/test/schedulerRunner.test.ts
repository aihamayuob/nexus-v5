import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { runDueSchedules, runMetaCognitionSweep, startSchedulerLoop } from '../src/scheduler/schedulerRunner.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string; stream?: boolean } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    if ((body.system ?? '').includes('أنت مخطط مهام')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ tasks: [{ id: 'only_task', description: 'أنجز المهمة', dependsOn: [] }] })));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } });
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'أُنجزت المهمة المجدولة.' } });
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
      frame('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('أُنجزت المهمة المجدولة.'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_BASE_URL = serverUrl;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  freshDb();
});

test('runDueSchedules dispatches a real due schedule through the real autonomousCore pipeline and records success', async () => {
  const repos = getRepos();
  const schedule = repos.schedules.create('مهمة مجدولة حقيقية', 'anthropic', 'claude-x', { type: 'interval', everyMs: 60_000 });
  assert.equal(schedule.lastRunAt, null);

  const { dispatched } = await runDueSchedules();
  assert.deepEqual(dispatched, [schedule.id]);

  const updated = repos.schedules.get(schedule.id)!;
  assert.ok(updated.lastRunAt !== null, 'a real dispatch should have actually updated lastRunAt');
  assert.equal(updated.lastStatus, 'success');
});

test('runDueSchedules does NOT dispatch a schedule that is not due yet — real due-check enforcement, not "run everything"', async () => {
  const repos = getRepos();
  const schedule = repos.schedules.create('مهمة غير مستحقة بعد', 'anthropic', 'claude-x', { type: 'interval', everyMs: 3_600_000 });
  repos.schedules.recordRun(schedule.id, 'success'); // just ran — next run isn't due for another hour

  const { dispatched } = await runDueSchedules();
  assert.deepEqual(dispatched, []);
});

test('runDueSchedules dispatches multiple independent real due schedules in the same sweep', async () => {
  const repos = getRepos();
  const first = repos.schedules.create('مهمة أولى', 'anthropic', 'claude-x', { type: 'interval', everyMs: 60_000 });
  const second = repos.schedules.create('مهمة ثانية', 'anthropic', 'claude-x', { type: 'interval', everyMs: 60_000 });

  const { dispatched } = await runDueSchedules();
  assert.equal(dispatched.length, 2);
  assert.ok(dispatched.includes(first.id));
  assert.ok(dispatched.includes(second.id));
});

test('runDueSchedules with a disabled schedule never dispatches it', async () => {
  const repos = getRepos();
  const schedule = repos.schedules.create('مهمة معطّلة', 'anthropic', 'claude-x', { type: 'interval', everyMs: 60_000 });
  repos.schedules.setEnabled(schedule.id, false);

  const { dispatched } = await runDueSchedules();
  assert.deepEqual(dispatched, []);
});

test('runMetaCognitionSweep is real, synchronous, and creates real proposals from real recorded failures — zero LLM calls, safe to call every tick', () => {
  const repos = getRepos();
  for (let i = 0; i < 4; i++) {
    repos.agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل ${i}` });
  }
  runMetaCognitionSweep();
  const proposals = repos.improvementProposals.list({ subjectType: 'failure_pattern' });
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.subjectId, 'financial');
});

test('runMetaCognitionSweep never throws even if called with a completely empty database', () => {
  assert.doesNotThrow(() => runMetaCognitionSweep());
});

test('startSchedulerLoop actually fires a real sweep on a real short interval, and clearInterval genuinely stops it', async () => {
  const repos = getRepos();
  for (let i = 0; i < 4; i++) {
    repos.agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل ${i}` });
  }
  // the immediate synchronous sweep inside startSchedulerLoop() should already create the proposal even before the first interval tick
  const timer = startSchedulerLoop(50);
  await new Promise((r) => setTimeout(r, 10));
  const proposalsAfterImmediateSweep = repos.improvementProposals.list({ subjectType: 'failure_pattern' });
  assert.equal(proposalsAfterImmediateSweep.length, 1, 'startSchedulerLoop should run one real sweep immediately, not wait for the first interval tick');

  clearInterval(timer);
  // record a second, distinct pattern AFTER stopping — if the timer were still running, this would eventually get swept too
  for (let i = 0; i < 4; i++) {
    repos.agentFailures.record({ agentId: 'marketing', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل ${i}` });
  }
  await new Promise((r) => setTimeout(r, 150)); // well past 3 more would-be ticks if the timer leaked
  const proposalsAfterStop = repos.improvementProposals.list({ subjectType: 'failure_pattern' });
  assert.equal(proposalsAfterStop.length, 1, 'clearInterval should have genuinely stopped the loop — no new sweep should have picked up the marketing pattern');
});
