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

before(async () => {
  fakeAnthropic = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    if ((body.system ?? '').includes('مراجع مستقل صارم')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ verdict: 'ok', issues: [] })));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('رد عبر HTTP.'));
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

test('POST /v2/council creates a session and returns 202 immediately', async () => {
  const start = Date.now();
  const res = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'اختبار المجلس عبر HTTP', proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  const elapsed = Date.now() - start;
  assert.equal(res.status, 202);
  const body = (await res.json()) as { sessionId: string };
  assert.ok(body.sessionId);
  assert.ok(elapsed < 500, `should return immediately; took ${elapsed}ms`);
});

test('POST /v2/council with a missing topic is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  assert.equal(res.status, 400);
});

test('POST /v2/council with an unknown agent id is a validation error, not a 500', async () => {
  const res = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'اختبار', proposerAgentId: 'nonexistent_agent', criticAgentId: 'legal' }),
  });
  assert.equal(res.status, 400);
});

test('GET /v2/council/:id reflects real progress through to COMPLETED, and /rounds shows all 5 rounds', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'جلسة HTTP كاملة', proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  const { sessionId } = (await createRes.json()) as { sessionId: string };

  let session: { state: string; finalOutput: string | null } | null = null;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${nexusUrl}/v2/council/${sessionId}`);
    assert.equal(res.status, 200);
    session = (await res.json()) as typeof session;
    if (session!.state === 'COMPLETED' || session!.state === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(session!.state, 'COMPLETED');
  assert.ok(session!.finalOutput);

  const roundsRes = await fetch(`${nexusUrl}/v2/council/${sessionId}/rounds`);
  assert.equal(roundsRes.status, 200);
  const roundsBody = (await roundsRes.json()) as { rounds: Array<{ kind: string }> };
  assert.equal(roundsBody.rounds.length, 5);
});

test('GET /v2/council/:id for an unknown id is a 404, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/v2/council/does-not-exist`);
  assert.equal(res.status, 404);
});

test('POST /v2/council/:id/cancel accepts a cancellation request for a real session', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'جلسة سنلغيها', proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  const { sessionId } = (await createRes.json()) as { sessionId: string };
  const res = await fetch(`${nexusUrl}/v2/council/${sessionId}/cancel`, { method: 'POST' });
  assert.equal(res.status, 202);
});

test('POST /v2/council with mode="situation_room" creates and completes a real multi-specialist session end to end', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'situation_room', topic: 'اختبار غرفة العمليات عبر HTTP', participantAgentIds: ['financial', 'legal'] }),
  });
  assert.equal(createRes.status, 202);
  const { sessionId } = (await createRes.json()) as { sessionId: string };

  let session: { state: string; participantAgentIds: string[] | null } | null = null;
  for (let i = 0; i < 50; i++) {
    const res = await fetch(`${nexusUrl}/v2/council/${sessionId}`);
    session = (await res.json()) as typeof session;
    if (session!.state === 'COMPLETED' || session!.state === 'FAILED') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(session!.state, 'COMPLETED');
  assert.deepEqual(session!.participantAgentIds, ['financial', 'legal']);
});

test('POST /v2/council with mode="situation_room" and only 1 participant is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'situation_room', topic: 'اختبار', participantAgentIds: ['financial'] }),
  });
  assert.equal(res.status, 400);
});

test('POST /v2/council with no mode still defaults to cross_exam (backward compatibility) — regression', async () => {
  const res = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'اختبار التوافق مع الإصدار السابق', proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  assert.equal(res.status, 202);
});

test('POST /v2/council/:id/cancel for an unknown id is a 404, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/v2/council/does-not-exist/cancel`, { method: 'POST' });
  assert.equal(res.status, 404);
});
