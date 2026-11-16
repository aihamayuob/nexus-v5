import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { runCouncilSession, getCouncilSession, cancelCouncilSession } from '../src/council/councilRunner.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let behavior: { hangForever: boolean; failCritique: boolean };

function resetBehavior() {
  behavior = { hangForever: false, failCritique: false };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    if (behavior.hangForever) return; // never responds — exercises cancellation
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
      res.end(anthropicTextResponse(JSON.stringify({ verdict: 'issues_found', issues: ['خطر تركّز مفرط'] })));
      return;
    }
    if (userMsg.includes('هاجم الاقتراح التالي')) {
      if (behavior.failCritique) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'critic provider down' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('نقد: الاقتراح يفتقر لتنويع المخاطر.'));
      return;
    }
    if (userMsg.includes('رد على نقد زميلك')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('رد: تم تعديل الاقتراح ليشمل تنويعاً أوسع.'));
      return;
    }
    if (userMsg.includes('اصغ الحل النهائي')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('الحل النهائي الأمتن: استراتيجية متوازنة تراعي كل الملاحظات.'));
      return;
    }
    // default: proposal round
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('اقتراح أولي: خصص جزءاً من المحفظة للذهب.'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
  throw new Error('timed out waiting for terminal council state');
}

test('runCouncilSession rejects an unknown proposer agent id up front (validation, not a hang)', async () => {
  await assert.rejects(() => runCouncilSession({ topic: 'اختبار', proposerAgentId: 'not_real', criticAgentId: 'legal' }, ctx), /وكيل الاقتراح غير معروف/);
});

test('runCouncilSession rejects proposer === critic', async () => {
  await assert.rejects(() => runCouncilSession({ topic: 'اختبار', proposerAgentId: 'financial', criticAgentId: 'financial' }, ctx), /مختلفين/);
});

test('a full cross-exam session runs all 5 rounds in order and completes with a real synthesis', async () => {
  const { sessionId } = await runCouncilSession({ topic: 'هل تخصيص 10% للذهب معقول؟', proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED');
  assert.ok(session.finalOutput?.includes('الحل النهائي'));
  assert.equal(session.verificationVerdict, 'issues_found');
  assert.equal(session.verificationIssueCount, 1);

  const rounds = getRepos().council.rounds(sessionId);
  assert.equal(rounds.length, 5);
  assert.deepEqual(
    rounds.map((r) => r.kind),
    ['proposal', 'critique', 'rebuttal', 'verification', 'synthesis']
  );
  assert.equal(rounds[0]!.agentId, 'financial');
  assert.equal(rounds[1]!.agentId, 'legal');
  assert.equal(rounds[2]!.agentId, 'financial');
  assert.equal(rounds[3]!.agentId, null); // verification isn't an agent turn
  assert.equal(rounds[4]!.agentId, 'supervisor'); // default supervisor id
});

test('a real provider failure mid-session fails the session cleanly, not silently', async () => {
  behavior.failCritique = true;
  const { sessionId } = await runCouncilSession({ topic: 'اختبار فشل الناقد', proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'FAILED');
  assert.ok(session.errorMessage);
  // only the proposal round should have persisted before the failure
  const rounds = getRepos().council.rounds(sessionId);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0]!.kind, 'proposal');
});

test('cancelCouncilSession actually aborts an in-flight session (bounded, not hung)', async () => {
  behavior.hangForever = true;
  const { sessionId } = await runCouncilSession({ topic: 'اختبار الإلغاء', proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
  await new Promise((r) => setTimeout(r, 50)); // let the proposal call actually start
  const cancelled = cancelCouncilSession(sessionId);
  assert.equal(cancelled, true);
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'FAILED');
  assert.match(session.errorMessage ?? '', /ألغيت|إلغاء/);
});

test('cancelCouncilSession on an unknown/already-finished session returns false, not a crash', () => {
  assert.equal(cancelCouncilSession('does-not-exist'), false);
});
