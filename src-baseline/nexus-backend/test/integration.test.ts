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
  fakeAnthropic = await startFakeAnthropicServer();
  process.env.NEXUS_ANTHROPIC_BASE_URL = fakeAnthropic.url;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'test-key-123';

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

test('GET /v2/health responds ok', async () => {
  const res = await fetch(`${nexusUrl}/v2/health`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.ok, true);
});

test('GET /v2/models exposes provider capability metadata and NEVER an API key', async () => {
  const res = await fetch(`${nexusUrl}/v2/models`);
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  const anthropic = body.providers.find((p: { id: string }) => p.id === 'anthropic');
  assert.ok(anthropic);
  assert.equal(anthropic.configured, true);
  assert.equal(JSON.stringify(body).includes('test-key-123'), false, 'API key must never appear in a client-facing payload');
});

test('POST /api/chat (non-streaming) returns the exact Anthropic-shaped legacy envelope', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'anthropic',
      max_tokens: 200,
      system: 'be helpful',
      messages: [{ role: 'user', content: 'hello there' }],
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.ok(Array.isArray(body.content));
  assert.equal(body.content[0].type, 'text');
  assert.equal(body.stop_reason, 'end_turn');
  assert.equal(typeof body.usage.input_tokens, 'number');
  assert.equal(typeof body.usage.output_tokens, 'number');
});

test('POST /api/chat (streaming) emits legacy-shaped SSE events: start, token, usage, done', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'anthropic',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'stream please' }],
      stream: true,
    }),
  });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));

  const events = await readAllSseEvents(res);
  const eventNames = events.map((e) => e.event);
  assert.ok(eventNames.includes('start'));
  assert.ok(eventNames.includes('token'));
  assert.ok(eventNames.includes('usage'));
  assert.ok(eventNames.includes('done'));
  const startEvent = events.find((e) => e.event === 'start')!;
  assert.ok(typeof startEvent.data.requestId === 'string');
  const doneEvent = events.find((e) => e.event === 'done')!;
  assert.equal(doneEvent.data.stopReason, 'end_turn');
  // every event must carry a monotonically increasing `id:` field (resume support)
  const ids = events.map((e) => e.id).filter((x): x is number => x != null);
  assert.ok(ids.length > 0);
  for (let i = 1; i < ids.length; i++) assert.ok(ids[i]! > ids[i - 1]!);
});

test('Tool-use round trip: model requests calculate, backend executes it server-side, final answer comes back', async () => {
  let callCount = 0;
  fakeAnthropic.requestLog.length = 0;
  const originalRespond = (fakeAnthropic as unknown as { respond?: unknown }).respond;
  void originalRespond;

  // Swap in a stateful responder: first call asks for the tool, second call (which includes the tool_result) gives a final text answer.
  const server2 = await startFakeAnthropicServer({
    respond: (body) => {
      callCount++;
      const hasToolResult = body.messages.some(
        (m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result')
      );
      if (hasToolResult) return { text: 'The answer is forty-two.', stopReason: 'end_turn' };
      return { toolUse: { id: 'call_1', name: 'calculate', input: { expression: '6*7' } }, stopReason: 'tool_use' };
    },
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = server2.url;
  clearAdapterCacheForTests(); // the adapter cache resolves+captures baseUrl at construction time (see providers/index.ts) — clear it so the swapped fake server actually takes effect

  try {
    const res = await fetch(`${nexusUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        max_tokens: 300,
        messages: [{ role: 'user', content: 'what is 6 times 7' }],
        tools: [
          {
            name: 'calculate',
            description: 'math',
            input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
          },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as any;
    assert.equal(callCount, 2, 'the model should be called twice: once to request the tool, once with the tool result');
    const textBlock = body.content.find((b: { type: string }) => b.type === 'text');
    assert.ok(textBlock.text.includes('forty-two'));
  } finally {
    process.env.NEXUS_ANTHROPIC_BASE_URL = fakeAnthropic.url;
    clearAdapterCacheForTests();
    await new Promise((resolve) => server2.server.close(resolve));
  }
});

test('POST /api/runtime/plan + /api/runtime/run: full DAG executes with real task_start/task_done/plan_done events', async () => {
  const planServer = await startFakeAnthropicServer({
    respond: (body) => {
      const userMsg = JSON.stringify(body.messages);
      if (userMsg.includes('مخطط مهام') || (body.system || '').includes('مخطط مهام')) {
        return {
          text: JSON.stringify({
            tasks: [
              { id: 'gather', description: 'gather info', dependsOn: [] },
              { id: 'summarize', description: 'summarize it', dependsOn: ['gather'] },
            ],
          }),
        };
      }
      return { text: 'node or synthesis output' };
    },
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = planServer.url;
  clearAdapterCacheForTests();

  try {
    const planRes = await fetch(`${nexusUrl}/api/runtime/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'research and summarize something', provider: 'anthropic' }),
    });
    assert.equal(planRes.status, 200);
    const planBody = await planRes.json() as any;
    assert.equal(planBody.tasks.length, 2);
    assert.deepEqual(planBody.tasks[1].dependsOn, ['gather']);

    const runRes = await fetch(`${nexusUrl}/api/runtime/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: { goal: planBody.goal, provider: planBody.provider, tasks: planBody.tasks } }),
    });
    assert.equal(runRes.status, 200);
    const events = await readAllSseEvents(runRes);
    const names = events.map((e) => e.event);
    assert.ok(names.includes('task_start'));
    assert.ok(names.includes('task_done'));
    assert.ok(names.includes('plan_done'));
    const doneEvents = events.filter((e) => e.event === 'task_done');
    assert.equal(doneEvents.length, 2, 'both DAG nodes should complete');
  } finally {
    process.env.NEXUS_ANTHROPIC_BASE_URL = fakeAnthropic.url;
    clearAdapterCacheForTests();
    await new Promise((resolve) => planServer.server.close(resolve));
  }
});

test('SSRF guard blocks web_fetch tool requests to private IP ranges', async () => {
  const res = await fetch(`${nexusUrl}/api/tools/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1:1/secret' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error.code, 'ssrf_blocked');
});

test('SSRF guard also blocks the AWS/GCP/Azure metadata address', async () => {
  const res = await fetch(`${nexusUrl}/api/tools/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data/' }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error.code, 'ssrf_blocked');
});

test('POST /api/chat rejects an unknown provider with a validation error, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'totally-fake-provider', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
  });
  assert.equal(res.status, 400);
  const body = await res.json() as any;
  assert.equal(body.error.code, 'validation_error');
});

// --- SSE parsing helper, mirrors the frontend's own parseOneSSEFrame() contract ---
async function readAllSseEvents(res: Response): Promise<Array<{ event: string; data: Record<string, unknown>; id: number | null }>> {
  const text = await res.text();
  const frames = text.split('\n\n').filter((f) => f.trim());
  return frames.map((raw) => {
    let event = '';
    let dataLine = '';
    let id: number | null = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
      else if (line.startsWith('id:')) id = Number(line.slice(3).trim());
    }
    return { event, data: dataLine ? JSON.parse(dataLine) : {}, id };
  });
}
