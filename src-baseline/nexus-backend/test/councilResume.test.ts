import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { getCouncilSession, cancelCouncilSession, resumeInterruptedCouncilSessions } from '../src/council/councilRunner.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let behavior: { hangForever: boolean };
let calls: { proposal: number; critique: number; rebuttal: number; verification: number; synthesis: number };

function resetBehavior() {
  behavior = { hangForever: false };
  calls = { proposal: 0, critique: 0, rebuttal: 0, verification: 0, synthesis: 0 };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      // Provider/model-catalog health-check probe — not a council round, must never be counted as one (also matches the pattern already used in test/wardenPauseResumeIsolate.test.ts).
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (behavior.hangForever) return;
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
      calls.verification++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ verdict: 'ok', issues: [] })));
      return;
    }
    if (userMsg.includes('هاجم الاقتراح التالي')) {
      calls.critique++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('نقد مُولَّد حديثاً (يجب ألا يظهر عند الاستئناف).'));
      return;
    }
    if (userMsg.includes('رد على نقد زميلك')) {
      calls.rebuttal++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('رد جديد بعد الاستئناف.'));
      return;
    }
    if (userMsg.includes('اصغ الحل النهائي')) {
      calls.synthesis++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('الحل النهائي بعد الاستئناف.'));
      return;
    }
    calls.proposal++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('اقتراح مُولَّد حديثاً (يجب ألا يظهر عند الاستئناف).'));
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

test('resuming a cross_exam session with proposal+critique already persisted only re-runs rebuttal, verification, synthesis — proposal/critique are reused verbatim', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'council_resume_1', mode: 'cross_exam', topic: 'موضوع اختبار الاستئناف', proposerAgentId: 'financial', criticAgentId: 'legal', supervisorAgentId: 'supervisor' });
  assert.equal(session.state, 'RUNNING'); // simulates: process died mid-session, row never reached a terminal state
  repos.council.appendRound(session.id, 'proposal', 'financial', 'الاقتراح الأصلي المحفوظ قبل الانقطاع.', 'anthropic', 'claude-x');
  repos.council.appendRound(session.id, 'critique', 'legal', 'النقد الأصلي المحفوظ قبل الانقطاع.', 'anthropic', 'claude-x');

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.proposal, 0, 'proposal must be reused, not regenerated');
  assert.equal(calls.critique, 0, 'critique must be reused, not regenerated');
  assert.equal(calls.rebuttal, 1, 'rebuttal was never persisted, must run exactly once');
  assert.equal(calls.verification, 1, 'verification always re-runs once on resume, by design');
  assert.equal(calls.synthesis, 1, 'synthesis was never persisted, must run exactly once');

  const rounds = getRepos().council.rounds(session.id);
  assert.equal(rounds.length, 5);
  const proposalRound = rounds.find((r) => r.kind === 'proposal')!;
  assert.equal(proposalRound.content, 'الاقتراح الأصلي المحفوظ قبل الانقطاع.');
  const critiqueRound = rounds.find((r) => r.kind === 'critique')!;
  assert.equal(critiqueRound.content, 'النقد الأصلي المحفوظ قبل الانقطاع.');
});

test('resuming a cross_exam session with ALL rounds already persisted (crashed just before complete()) makes zero new agent calls except verification, and finalizes with the already-persisted synthesis', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'council_resume_2', mode: 'cross_exam', topic: 'موضوع آخر', proposerAgentId: 'financial', criticAgentId: 'legal', supervisorAgentId: 'supervisor' });
  repos.council.appendRound(session.id, 'proposal', 'financial', 'اقتراح محفوظ.', 'anthropic', 'claude-x');
  repos.council.appendRound(session.id, 'critique', 'legal', 'نقد محفوظ.', 'anthropic', 'claude-x');
  repos.council.appendRound(session.id, 'rebuttal', 'financial', 'رد محفوظ.', 'anthropic', 'claude-x');
  repos.council.appendRound(session.id, 'synthesis', 'supervisor', 'التركيب النهائي المحفوظ مسبقاً.', 'anthropic', 'claude-x');
  // Deliberately NOT appending a 'verification' round and NOT calling complete() — this is exactly the crash window this test targets.

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(finalSession.finalOutput, 'التركيب النهائي المحفوظ مسبقاً.');
  assert.equal(calls.proposal, 0);
  assert.equal(calls.critique, 0);
  assert.equal(calls.rebuttal, 0);
  assert.equal(calls.synthesis, 0);
  assert.equal(calls.verification, 1);

  const rounds = getRepos().council.rounds(session.id);
  assert.equal(rounds.length, 5); // the 4 seeded + the fresh verification round
});

test('Phase 3 Slice 15 superseded this test\'s premise (situation_room resume deferral) — real situation_room resume coverage now lives in test/situationRoomResume.test.ts. Kept here as a one-line marker rather than silently deleted, so the history of what changed and why stays visible in this file.', () => {
  assert.ok(true);
});

test('a cross_exam session with corrupted/missing proposer or critic data is marked FAILED safely instead of being resumed', async () => {
  const repos = getRepos();
  // proposerAgentId/criticAgentId omitted entirely — simulates a corrupted or hand-edited row.
  const session = repos.council.create({ id: 'council_resume_corrupt', mode: 'cross_exam', topic: 'موضوع فاسد', supervisorAgentId: 'supervisor' });
  assert.equal(session.proposerAgentId, null);

  await resumeInterruptedCouncilSessions();
  const finalSession = getCouncilSession(session.id)!;
  assert.equal(finalSession.state, 'FAILED');
  assert.match(finalSession.errorMessage ?? '', /ناقصة/);
  assert.equal(calls.proposal + calls.critique + calls.rebuttal + calls.verification + calls.synthesis, 0);
});

test('a genuinely resumed (still in-flight) cross_exam session can still be cancelled by id — resumeInterruptedCouncilSessions() correctly registers its AbortController', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'council_resume_cancel', mode: 'cross_exam', topic: 'موضوع سيُلغى بعد الاستئناف', proposerAgentId: 'financial', criticAgentId: 'legal', supervisorAgentId: 'supervisor' });
  repos.council.appendRound(session.id, 'proposal', 'financial', 'اقتراح محفوظ.', 'anthropic', 'claude-x');
  repos.council.appendRound(session.id, 'critique', 'legal', 'نقد محفوظ.', 'anthropic', 'claude-x');

  behavior.hangForever = true; // the rebuttal call (the first real work after resume) will now hang
  await resumeInterruptedCouncilSessions();
  await new Promise((r) => setTimeout(r, 150));

  const cancelled = cancelCouncilSession(session.id);
  assert.equal(cancelled, true, 'expected a live AbortController for the resumed session');

  const finalSession = await waitForTerminal(session.id);
  assert.equal(finalSession.state, 'FAILED');
  assert.equal(finalSession.errorMessage, 'تم إلغاء الجلسة يدويًا.');
});

test('interruptedSessions() only returns RUNNING sessions, never terminal ones', () => {
  const repos = getRepos();
  const running = repos.council.create({ id: 'c_running', mode: 'cross_exam', topic: 't', proposerAgentId: 'financial', criticAgentId: 'legal', supervisorAgentId: 'supervisor' });
  const completed = repos.council.create({ id: 'c_completed', mode: 'cross_exam', topic: 't', proposerAgentId: 'financial', criticAgentId: 'legal', supervisorAgentId: 'supervisor' });
  repos.council.complete(completed.id, 'output', 'ok', 0);

  const ids = repos.council.interruptedSessions().map((s) => s.id);
  assert.ok(ids.includes(running.id));
  assert.ok(!ids.includes(completed.id));
});
