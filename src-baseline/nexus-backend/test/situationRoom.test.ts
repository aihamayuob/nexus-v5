import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { runCouncilSession, getCouncilSession } from '../src/council/councilRunner.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let behavior: { failAgentId: string | null };

function resetBehavior() {
  behavior = { failAgentId: null };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string; messages?: Array<{ content?: string }> } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const system = body.system ?? '';
    const userMsg = body.messages?.[0]?.content ?? '';

    if (system.includes('مراجع مستقل صارم')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ verdict: 'ok', issues: [] })));
      return;
    }
    if (userMsg.includes('غرفة عمليات') && userMsg.includes('tension_summary')) {
      // supervisor's round-1 analysis — respond with real JSON, real followups keyed by real agent ids
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        anthropicTextResponse(
          JSON.stringify({
            tension_summary: 'هناك تعارض بين الرأي المالي والقانوني حول المخاطرة المقبولة.',
            followups: { financial: 'وضّح أثر التضخم تحديداً.', legal: 'هل هناك التزامات تعاقدية تمنع هذا؟' },
          })
        )
      );
      return;
    }
    if (userMsg.includes('التقرير التنفيذي') || userMsg.includes('تقريراً تنفيذياً')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('التقرير التنفيذي الموحد: توصية متوازنة بعد جولتين من النقاش.'));
      return;
    }

    // round 1 / round 2 specialist turns — simulate a per-agent failure if configured (system prompt text distinguishes agents; the request body never carries the agent's own id string)
    if (behavior.failAgentId === 'legal' && system.includes('مستشار قانوني')) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'مزود معطّل مؤقتاً' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('رأي متخصص حقيقي حول الموضوع.'));
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
  resetBehavior();
});

async function waitForTerminal(sessionId: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const s = getCouncilSession(sessionId);
    if (s && (s.state === 'COMPLETED' || s.state === 'FAILED' || s.state === 'CANCELLED')) return s;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('timed out waiting for terminal situation_room state');
}

test('situation_room rejects fewer than 2 participants', async () => {
  await assert.rejects(() => runCouncilSession({ mode: 'situation_room', topic: 'اختبار', participantAgentIds: ['financial'] }, ctx), /خبيرين/);
});

test('situation_room rejects a duplicated participant id', async () => {
  await assert.rejects(
    () => runCouncilSession({ mode: 'situation_room', topic: 'اختبار', participantAgentIds: ['financial', 'financial'] }, ctx),
    /تكرار/
  );
});

test('situation_room rejects an unknown participant agent id', async () => {
  await assert.rejects(
    () => runCouncilSession({ mode: 'situation_room', topic: 'اختبار', participantAgentIds: ['financial', 'not_real_agent'] }, ctx),
    /غير معروف/
  );
});

test('situation_room rejects the supervisor also appearing as a participant', async () => {
  await assert.rejects(
    () => runCouncilSession({ mode: 'situation_room', topic: 'اختبار', participantAgentIds: ['financial', 'supervisor'] }, ctx),
    /لا يمكن أن يكون المشرف/
  );
});

test('a full situation_room session with 3 specialists runs both real parallel rounds, real supervisor JSON follow-ups, and completes with a unified synthesis', async () => {
  const { sessionId } = await runCouncilSession(
    { mode: 'situation_room', topic: 'هل نزيد الاستثمار في الذهب هذا الربع؟', participantAgentIds: ['financial', 'legal', 'geo'] },
    ctx
  );
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED');
  assert.ok(session.finalOutput?.includes('التقرير التنفيذي'));
  assert.deepEqual(session.participantAgentIds, ['financial', 'legal', 'geo']);
  assert.equal(session.proposerAgentId, null); // situation_room sessions don't use the cross_exam fields
  assert.equal(session.criticAgentId, null);

  const rounds = getRepos().council.rounds(sessionId);
  const kinds = rounds.map((r) => r.kind);
  assert.equal(kinds.filter((k) => k === 'round1_opinion').length, 3, 'one round1_opinion row per real specialist');
  assert.ok(kinds.includes('supervisor_analysis'));
  assert.equal(kinds.filter((k) => k === 'round2_followup').length, 3, 'one round2_followup row per real specialist');
  assert.ok(kinds.includes('verification'));
  assert.ok(kinds.includes('synthesis'));

  const analysisRound = rounds.find((r) => r.kind === 'supervisor_analysis')!;
  assert.match(analysisRound.content, /تعارض/); // real JSON content was actually persisted, not a placeholder
});

test('situation_room tolerates one specialist failing in round 1 and still completes with the survivors (Promise.allSettled semantics, matching the frontend pattern)', async () => {
  behavior.failAgentId = 'legal';
  const { sessionId } = await runCouncilSession({ mode: 'situation_room', topic: 'اختبار تحمّل الفشل الجزئي', participantAgentIds: ['financial', 'legal', 'geo'] }, ctx);
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED', 'session should still complete using the 2 specialists that succeeded');

  const rounds = getRepos().council.rounds(sessionId);
  const round1Agents = rounds.filter((r) => r.kind === 'round1_opinion').map((r) => r.agentId);
  assert.deepEqual(round1Agents.sort(), ['financial', 'geo']);
});
