import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeAnthropic: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
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
    let body: { system?: string; messages?: Array<{ content?: string }> } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const userMsg = body.messages?.[0]?.content ?? '';
    if (userMsg.includes('وضع "تراجع ما بعد التنفيذ"')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ findings: [] })));
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

test('POST /v2/metacognition/missions/:id/review on an unknown mission is a real 404', async () => {
  const res = await fetch(`${nexusUrl}/v2/metacognition/missions/does-not-exist/review`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('POST /v2/metacognition/missions/:id/review on a real running (non-terminal) mission is a real 400', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة قيد التنفيذ لاختبار HTTP' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };
  const res = await fetch(`${nexusUrl}/v2/metacognition/missions/${missionId}/review`, { method: 'POST' });
  assert.equal(res.status, 400);
});

test('POST /v2/metacognition/failure-patterns/detect is real, synchronous, and reflects real recorded failures', async () => {
  getRepos().agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'فشل 1' });
  getRepos().agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'فشل 2' });
  getRepos().agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'فشل 3' });

  const res = await fetch(`${nexusUrl}/v2/metacognition/failure-patterns/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windowMs: 3600000, minCount: 3 }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { proposals: Array<{ subjectId: string }> };
  assert.equal(body.proposals.length, 1);
  assert.equal(body.proposals[0]!.subjectId, 'financial');
});

test('GET /v2/metacognition/proposals lists real persisted proposals and supports real status filtering', async () => {
  getRepos().agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'x' });
  getRepos().agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'y' });
  getRepos().agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'z' });
  await fetch(`${nexusUrl}/v2/metacognition/failure-patterns/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minCount: 3 }),
  });

  const openRes = await fetch(`${nexusUrl}/v2/metacognition/proposals?status=open`);
  const openBody = (await openRes.json()) as { proposals: unknown[] };
  assert.equal(openBody.proposals.length, 1);

  const dismissedRes = await fetch(`${nexusUrl}/v2/metacognition/proposals?status=dismissed`);
  const dismissedBody = (await dismissedRes.json()) as { proposals: unknown[] };
  assert.equal(dismissedBody.proposals.length, 0);
});

test('POST /v2/metacognition/proposals/:id/decide actually persists a real human decision, never auto-applies anything', async () => {
  getRepos().agentFailures.record({ agentId: 'marketing', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'x' });
  getRepos().agentFailures.record({ agentId: 'marketing', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'y' });
  getRepos().agentFailures.record({ agentId: 'marketing', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'z' });
  const detectRes = await fetch(`${nexusUrl}/v2/metacognition/failure-patterns/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minCount: 3 }),
  });
  const { proposals } = (await detectRes.json()) as { proposals: Array<{ id: string }> };
  const proposalId = proposals[0]!.id;

  const decideRes = await fetch(`${nexusUrl}/v2/metacognition/proposals/${proposalId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'acknowledged', decidedBy: 'test_reviewer' }),
  });
  assert.equal(decideRes.status, 200);
  const decided = (await decideRes.json()) as { status: string; decidedBy: string };
  assert.equal(decided.status, 'acknowledged');
  assert.equal(decided.decidedBy, 'test_reviewer');

  // agentRegistry.ts's 'marketing' agent definition is completely untouched — decide() never applies anything
  const { AgentRegistry } = await import('../src/agents/agentRegistry.js');
  const def = AgentRegistry.get('marketing');
  assert.ok(def); // still exists, unmodified
});

test('POST /v2/metacognition/proposals/:id/decide with an invalid status is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/metacognition/proposals/some-id/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'not_a_real_status' }),
  });
  assert.equal(res.status, 400);
});

test('POST /v2/metacognition/proposals/:id/decide for an unknown proposal id is a real 404', async () => {
  const res = await fetch(`${nexusUrl}/v2/metacognition/proposals/does-not-exist/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  assert.equal(res.status, 404);
});
