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

test('POST /v2/swarm dynamically selects real relevant agents and dispatches a real situation_room session, reachable via the existing council routes', async () => {
  const res = await fetch(`${nexusUrl}/v2/swarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'نحتاج استشارة مالية واستثمار وأيضاً رأي قانوني' }),
  });
  assert.equal(res.status, 202);
  const body = (await res.json()) as { sessionId: string; selectedAgentIds: string[] };
  assert.ok(body.sessionId.startsWith('council_'), 'a swarm session is a real council session underneath');
  assert.ok(body.selectedAgentIds.includes('financial'));
  assert.ok(body.selectedAgentIds.includes('legal'));

  let state = '';
  for (let i = 0; i < 50; i++) {
    const statusRes = await fetch(`${nexusUrl}/v2/council/${body.sessionId}`);
    const session = (await statusRes.json()) as { state: string; mode: string; participantAgentIds: string[] };
    state = session.state;
    if (state === 'COMPLETED' || state === 'FAILED') {
      assert.equal(session.mode, 'situation_room');
      assert.deepEqual(session.participantAgentIds, body.selectedAgentIds);
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(state, 'COMPLETED');
});

test('POST /v2/swarm with a topic too narrow to identify 2+ real specialists fails honestly with 400, not a fabricated panel', async () => {
  const res = await fetch(`${nexusUrl}/v2/swarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'سؤال بسيط جداً عن الطقس' }),
  });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: { message: string } };
  assert.match(body.error.message, /تعذّر تكوين سرب/);
});

test('POST /v2/swarm with a missing topic is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/swarm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test('POST /v2/swarm respects a custom maxAgents cap', async () => {
  const res = await fetch(`${nexusUrl}/v2/swarm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'نحتاج استشارة مالية واستثمار ورأي قانوني وتسويقي وتقني شامل للمشروع', maxAgents: 2 }),
  });
  assert.equal(res.status, 202);
  const body = (await res.json()) as { selectedAgentIds: string[] };
  assert.equal(body.selectedAgentIds.length, 2);
});
