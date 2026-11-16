import './helpers/setTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { bootstrapTools } from '../src/tools/bootstrap.js';
import { startFakeAnthropicServer } from './helpers/fakeAnthropicServer.js';
import { clearAdapterCacheForTests } from '../src/providers/index.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeAnthropic: Awaited<ReturnType<typeof startFakeAnthropicServer>>;

before(async () => {
  bootstrapTools();
  fakeAnthropic = await startFakeAnthropicServer({
    respond: (body) => {
      const sys = body.system || '';
      if (sys.includes('مخطط مهام')) {
        return {
          text: JSON.stringify({ tasks: [{ id: 'analysis', description: 'analyze the request', dependsOn: [] }] }),
        };
      }
      if (sys.includes('مراجع مستقل صارم')) {
        return { text: JSON.stringify({ verdict: 'ok', issues: [] }) };
      }
      return { text: 'a considered, complete response' };
    },
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = fakeAnthropic.url;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'test-key';
  clearAdapterCacheForTests();

  nexusServer = createNexusServer();
  await new Promise<void>((resolve) => nexusServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = nexusServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  nexusUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => nexusServer.close(resolve));
  await new Promise((resolve) => fakeAnthropic.server.close(resolve));
});

async function readAllSseEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((f) => f.trim())
    .map((raw) => {
      let event = '';
      let dataLine = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      }
      return { event, data: dataLine ? JSON.parse(dataLine) : {} };
    });
}

test('POST /v2/tasks: a simple LOW-tier request takes the fast path — task_meta reports tier=LOW, no planner call', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'what is the capital of France', provider: 'anthropic' }),
  });
  assert.equal(res.status, 200);
  const events = await readAllSseEvents(res);
  const meta = events.find((e) => e.event === 'task_meta');
  assert.ok(meta);
  assert.equal(meta!.data.tier, 'LOW');
  assert.equal(meta!.data.useMultiAgent, false);
  assert.equal(meta!.data.requireApproval, false);
  const done = events.find((e) => e.event === 'done');
  assert.ok(done, 'expected a v2 done event for the fast path');
  assert.equal(typeof done!.data.finalOutput, 'string');
});

test('POST /v2/tasks: a high-complexity analytical request escalates to the planner/DAG path (tier=HIGH)', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'قارن استراتيجيات الاستثمار طويلة وقصيرة المدى وحلل المخاطر بالتفصيل الكامل', provider: 'anthropic' }),
  });
  assert.equal(res.status, 200);
  const events = await readAllSseEvents(res);
  const meta = events.find((e) => e.event === 'task_meta');
  assert.ok(meta);
  assert.equal(meta!.data.tier, 'HIGH');
  assert.equal(meta!.data.useMultiAgent, true);
  assert.equal(meta!.data.requireApproval, false);
  assert.ok(events.some((e) => e.event === 'plan_done'), 'HIGH tier should run through the DAG and reach plan_done');
});

test('POST /v2/tasks: a HIGH_RISK request is held for human approval instead of auto-delivered', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'ما هي جرعة الدواء الآمنة لطفل عمره 3 سنوات؟', provider: 'anthropic' }),
  });
  assert.equal(res.status, 200);
  const events = await readAllSseEvents(res);
  const meta = events.find((e) => e.event === 'task_meta');
  assert.equal(meta!.data.tier, 'HIGH_RISK');
  assert.equal(meta!.data.requireApproval, true);
  assert.ok(events.some((e) => e.event === 'approval_required'), 'expected the stream to pause for approval, not auto-deliver');
  assert.ok(!events.some((e) => e.event === 'plan_done'), 'must NOT deliver a final result before approval');

  // Find the pending approval and approve it.
  const pendingRes = await fetch(`${nexusUrl}/v2/approvals`);
  const pendingBody = (await pendingRes.json()) as any;
  assert.ok(pendingBody.pending.length >= 1);
  const taskId = pendingBody.pending[0].taskId;

  const decideRes = await fetch(`${nexusUrl}/v2/approvals/${taskId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved', decidedBy: 'test-reviewer' }),
  });
  assert.equal(decideRes.status, 200);
  const decideBody = (await decideRes.json()) as any;
  assert.equal(typeof decideBody.finalOutput, 'string');

  // Confirm the task is now actually done.
  const taskRes = await fetch(`${nexusUrl}/v2/tasks/${taskId}`);
  const taskBody = (await taskRes.json()) as any;
  assert.equal(taskBody.task.status, 'done');
  assert.equal(taskBody.approval.status, 'approved');
});

test('POST /v2/approvals/:id/decide with rejected marks the task cancelled, not done', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'ما هي جرعة دواء آمنة لرضيع؟', provider: 'anthropic' }),
  });
  const events = await readAllSseEvents(res);
  const taskId = events.find((e) => e.event === 'task_meta')!.data.taskId as string;

  const decideRes = await fetch(`${nexusUrl}/v2/approvals/${taskId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'rejected' }),
  });
  assert.equal(decideRes.status, 200);

  const taskRes = await fetch(`${nexusUrl}/v2/tasks/${taskId}`);
  const taskBody = (await taskRes.json()) as any;
  assert.equal(taskBody.task.status, 'cancelled');
});

test('a second decision on the same approval is rejected with a conflict, not silently accepted', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'ما هي جرعة عقار آمنة لطفل رضيع؟', provider: 'anthropic' }),
  });
  const events = await readAllSseEvents(res);
  const taskId = events.find((e) => e.event === 'task_meta')!.data.taskId as string;

  await fetch(`${nexusUrl}/v2/approvals/${taskId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approved' }),
  });
  const secondDecision = await fetch(`${nexusUrl}/v2/approvals/${taskId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'rejected' }),
  });
  assert.equal(secondDecision.status, 409);
});

test('POST /v2/feedback records a rating against a real completed task', async () => {
  const res = await fetch(`${nexusUrl}/v2/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'what is 2 plus 2', provider: 'anthropic' }),
  });
  const events = await readAllSseEvents(res);
  const taskId = events.find((e) => e.event === 'task_meta')!.data.taskId as string;

  const fbRes = await fetch(`${nexusUrl}/v2/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId, rating: 'up', note: 'great answer' }),
  });
  assert.equal(fbRes.status, 200);
});

test('POST /v2/feedback rejects feedback for a nonexistent task', async () => {
  const res = await fetch(`${nexusUrl}/v2/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'does-not-exist', rating: 'up' }),
  });
  assert.equal(res.status, 404);
});

test('POST /v2/evaluation/run executes the real benchmark suite over HTTP and returns a summary', async () => {
  const res = await fetch(`${nexusUrl}/v2/evaluation/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ releaseLabel: 'http-test-release' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.summary.total > 10);
  assert.equal(typeof body.regression.hasRegressions, 'boolean');
});

test('GET /v2/evaluation/latest returns the most recently stored run', async () => {
  const res = await fetch(`${nexusUrl}/v2/evaluation/latest`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.releaseLabel, 'http-test-release');
});

test('Secure headers are present on every response', async () => {
  const res = await fetch(`${nexusUrl}/v2/health`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'none'"));
});
