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
let hangForever = false;

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
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (hangForever) return; // never respond — this now correctly gets interrupted by cancellation even during planning, per the abort-signal fix in planner.ts/missionRunner.ts
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
  fakeAnthropic.closeAllConnections();
  await Promise.all([new Promise((r) => nexusServer.close(r)), new Promise((r) => fakeAnthropic.close(r))]);
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  hangForever = false;
});

test('GET /v2/warden/status returns a real, well-shaped operational snapshot', async () => {
  const res = await fetch(`${nexusUrl}/v2/warden/status`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { budget: { enabled: boolean }; activeMissions: number; activeCouncilSessions: number; pendingApprovals: number };
  assert.equal(typeof body.budget.enabled, 'boolean');
  assert.equal(body.activeMissions, 0);
  assert.equal(body.activeCouncilSessions, 0);
  assert.equal(body.pendingApprovals, 0);
});

test('GET /v2/warden/status reflects a real in-flight mission started via HTTP', async () => {
  hangForever = true;
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة لقياس حالة Warden عبر HTTP' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };
  await new Promise((r) => setTimeout(r, 150));

  const statusRes = await fetch(`${nexusUrl}/v2/warden/status`);
  const status = (await statusRes.json()) as { activeMissions: number };
  assert.ok(status.activeMissions >= 1);

  await fetch(`${nexusUrl}/v2/missions/${missionId}/cancel`, { method: 'POST' });
});

test('POST /v2/missions/:id/cancel (now routed through Warden) still returns 202 for a real mission — regression', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objective: 'مهمة سنلغيها عبر Warden' }),
  });
  const { missionId } = (await createRes.json()) as { missionId: string };
  const res = await fetch(`${nexusUrl}/v2/missions/${missionId}/cancel`, { method: 'POST' });
  assert.equal(res.status, 202);
  const body = (await res.json()) as { cancelling: boolean };
  assert.equal(typeof body.cancelling, 'boolean');
});

test('POST /v2/missions/:id/cancel for an unknown id is still a 404 (via Warden.cancelMission throwing not_found) — regression', async () => {
  const res = await fetch(`${nexusUrl}/v2/missions/does-not-exist/cancel`, { method: 'POST' });
  assert.equal(res.status, 404);
});

test('POST /v2/council/:id/cancel (now routed through Warden) still returns 202 for a real session — regression', async () => {
  const createRes = await fetch(`${nexusUrl}/v2/council`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic: 'جلسة سنلغيها عبر Warden', proposerAgentId: 'financial', criticAgentId: 'legal' }),
  });
  const { sessionId } = (await createRes.json()) as { sessionId: string };
  const res = await fetch(`${nexusUrl}/v2/council/${sessionId}/cancel`, { method: 'POST' });
  assert.equal(res.status, 202);
});

test('POST /v2/council/:id/cancel for an unknown id is still a 404 — regression', async () => {
  const res = await fetch(`${nexusUrl}/v2/council/does-not-exist/cancel`, { method: 'POST' });
  assert.equal(res.status, 404);
});
