import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeAnthropic: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } });
}

function writeAnthropicSse(res: import('node:http').ServerResponse, text: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const frame = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 5 } } });
  frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
  frame('message_stop', { type: 'message_stop' });
  res.end();
}

before(async () => {
  fakeAnthropic = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string; stream?: boolean } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const system = body.system ?? '';
    if (system.includes('أنت مخطط مهام')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ tasks: [{ id: 'only_task', description: 'أنجز المهمة', dependsOn: [] }] })));
      return;
    }
    if (body.stream) {
      writeAnthropicSse(res, 'تم إنجاز المهمة عبر HTTP.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('تم إنجاز المهمة عبر HTTP.'));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(fakeAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await Promise.all([new Promise((r) => nexusServer.close(r)), new Promise((r) => fakeAnthropic.close(r))]);
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

test('POST /v2/missions creates a mission and returns 202 immediately (fire-and-poll, not a blocking call)', async () => {
  const start = Date.now();
  const res = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'اكتب جملة عن الطقس' }),
  });
  const elapsed = Date.now() - start;
  assert.equal(res.status, 202);
  const body = (await res.json()) as { missionId: string };
  assert.ok(body.missionId);
  assert.ok(elapsed < 500, `POST should return immediately, not wait for the mission to finish; took ${elapsed}ms`);
});

test('POST /v2/missions without an objective is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/missions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('GET /v2/missions/:id reflects real progress through to COMPLETED', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة اختبار HTTP كاملة' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };

  let mission: { state: string; result: { finalOutput: string } | null } | null = null;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${nexusUrl}/v2/missions/${missionId}`);
    assert.equal(res.status, 200);
    mission = (await res.json()) as typeof mission;
    if (mission!.state === 'COMPLETED' || mission!.state === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(mission!.state, 'COMPLETED');
  assert.ok(mission!.result?.finalOutput);
});

test('GET /v2/missions/:id for an unknown id is a 404, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/v2/missions/does-not-exist`);
  assert.equal(res.status, 404);
});

test('GET /v2/missions/:id/transitions returns the full audited state history', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة لتتبع الانتقالات' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };
  await new Promise((r) => setTimeout(r, 800));
  const res = await fetch(`${nexusUrl}/v2/missions/${missionId}/transitions`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { transitions: Array<{ toState: string }> };
  assert.ok(body.transitions.length >= 2);
  assert.equal(body.transitions[0]!.toState, 'PLANNING');
});

test('POST /v2/missions/:id/cancel accepts a cancellation request for a real mission', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة سنلغيها عبر HTTP' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };
  const res = await fetch(`${nexusUrl}/v2/missions/${missionId}/cancel`, { method: 'POST' });
  assert.equal(res.status, 202);
});

test('POST /v2/missions/:id/cancel for an unknown id is a 404, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/v2/missions/does-not-exist/cancel`, { method: 'POST' });
  assert.equal(res.status, 404);
});
