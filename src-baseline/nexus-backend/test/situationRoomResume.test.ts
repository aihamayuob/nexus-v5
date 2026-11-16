import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { getCouncilSession, resumeInterruptedCouncilSessions } from '../src/council/councilRunner.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let calls: { round1: number; round2: number; supervisorAnalysis: number; humanitarianVeto: number; verification: number; synthesis: number };

function resetCalls() {
  calls = { round1: 0, round2: 0, supervisorAnalysis: 0, humanitarianVeto: 0, verification: 0, synthesis: 0 };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
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
    if (userMsg.includes('راجع النقاش الكامل')) {
      calls.humanitarianVeto++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('لا يوجد أي بند مرفوض في هذا النقاش.'));
      return;
    }
    if (userMsg.includes('تدير "غرفة عمليات"')) {
      calls.supervisorAnalysis++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ tension_summary: 'تحليل جديد', followups: { financial: 'تابع؟', legal: 'تابع؟', humanitarian_aid: 'تابع؟' } })));
      return;
    }
    if (userMsg.includes('بناءً على نقاش غرفة العمليات الكامل')) {
      calls.synthesis++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('التقرير التنفيذي النهائي — بعد الاستئناف.'));
      return;
    }
    if (userMsg.includes('سؤال المشرف الموجّه لك تحديداً')) {
      calls.round2++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('رأي الجولة الثانية — بعد الاستئناف.'));
      return;
    }
    calls.round1++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('رأي الجولة الأولى — بعد الاستئناف.'));
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
  resetCalls();
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

test('resuming situation_room with round1_opinion persisted for only ONE of two participants re-runs just the missing one, reuses the other verbatim', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'sr_partial_round1', mode: 'situation_room', topic: 'موضوع جزئي', participantAgentIds: ['financial', 'legal'], supervisorAgentId: 'supervisor' });
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'رأي مالي محفوظ قبل الانقطاع.', null, null);
  // 'legal' never got its round1 turn before the (simulated) crash.

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.round1, 1, 'only the missing participant (legal) should have been re-run for round1');

  const rounds = repos.council.rounds(session.id);
  const round1Rounds = rounds.filter((r) => r.kind === 'round1_opinion');
  assert.equal(round1Rounds.length, 2);
  const financialRound = round1Rounds.find((r) => r.agentId === 'financial')!;
  assert.equal(financialRound.content, 'رأي مالي محفوظ قبل الانقطاع.', 'financial\'s persisted round1 must be reused verbatim, not regenerated');
});

test('resuming situation_room with round1+round2 fully persisted for both participants, but crashed before supervisor_analysis, only runs supervisor_analysis/verification/synthesis fresh', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'sr_partial_round2', mode: 'situation_room', topic: 'موضوع', participantAgentIds: ['financial', 'legal'], supervisorAgentId: 'supervisor' });
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'رأي مالي 1.', null, null);
  repos.council.appendRound(session.id, 'round1_opinion', 'legal', 'رأي قانوني 1.', null, null);
  // Note: supervisor_analysis was never persisted, so per the real dependency chain round2 could not have run yet either — this row state is realistic for "crashed right after round1 finished".

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.round1, 0, 'both round1 turns were already persisted');
  assert.equal(calls.supervisorAnalysis, 1);
  assert.equal(calls.round2, 2, 'both participants need a fresh round2 turn');
  assert.equal(calls.verification, 1);
  assert.equal(calls.synthesis, 1);
});

test('resuming situation_room with everything through synthesis already persisted makes zero new calls except verification, and finalizes with the persisted synthesis', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'sr_almost_done', mode: 'situation_room', topic: 'موضوع', participantAgentIds: ['financial', 'legal'], supervisorAgentId: 'supervisor' });
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'ر1.', null, null);
  repos.council.appendRound(session.id, 'round1_opinion', 'legal', 'ر2.', null, null);
  repos.council.appendRound(session.id, 'supervisor_analysis', 'supervisor', JSON.stringify({ tension_summary: 'x', followups: {} }), null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'financial', 'ر3.', null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'legal', 'ر4.', null, null);
  repos.council.appendRound(session.id, 'synthesis', 'supervisor', 'التقرير النهائي المحفوظ مسبقاً.', null, null);
  // crashed between appending 'synthesis' and calling complete()

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(finalSession.finalOutput, 'التقرير النهائي المحفوظ مسبقاً.');
  assert.equal(calls.round1, 0);
  assert.equal(calls.supervisorAnalysis, 0);
  assert.equal(calls.round2, 0);
  assert.equal(calls.synthesis, 0);
  assert.equal(calls.verification, 1, 'verification always re-runs on resume, by design');
});

test('CRITICAL: humanitarianVeto=true, interrupted BEFORE that round ran — resume genuinely runs the humanitarian review, does not silently skip it', async () => {
  const repos = getRepos();
  const session = repos.council.create({
    id: 'sr_veto_pending',
    mode: 'situation_room',
    topic: 'موضوع حساس',
    participantAgentIds: ['financial', 'legal'],
    supervisorAgentId: 'supervisor',
    humanitarianVeto: true,
  });
  assert.equal(session.humanitarianVetoRequested, true, 'the flag must be durably persisted at creation time (migration 011)');
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'ر1.', null, null);
  repos.council.appendRound(session.id, 'round1_opinion', 'legal', 'ر2.', null, null);
  repos.council.appendRound(session.id, 'supervisor_analysis', 'supervisor', JSON.stringify({ tension_summary: 'x', followups: {} }), null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'financial', 'ر3.', null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'legal', 'ر4.', null, null);
  // Crashed right before the humanitarian_veto round — the highest-stakes resume gap this slice exists to close.

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.humanitarianVeto, 1, 'the humanitarian review must actually run on resume, never be silently skipped');
  const rounds = repos.council.rounds(session.id);
  assert.ok(rounds.some((r) => r.kind === 'humanitarian_veto'), 'a real humanitarian_veto round must be persisted');
  const vetoLog = repos.audit.listVeto(20);
  assert.equal(vetoLog.length, 1, 'exactly one audit-trail entry for the one genuine review that ran');
});

test('humanitarianVeto=true AND that round already persisted before the crash — resume reuses the saved review, does not re-run it, and does not duplicate the audit-trail entry', async () => {
  const repos = getRepos();
  const session = repos.council.create({
    id: 'sr_veto_done',
    mode: 'situation_room',
    topic: 'موضوع حساس آخر',
    participantAgentIds: ['financial', 'legal'],
    supervisorAgentId: 'supervisor',
    humanitarianVeto: true,
  });
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'ر1.', null, null);
  repos.council.appendRound(session.id, 'round1_opinion', 'legal', 'ر2.', null, null);
  repos.council.appendRound(session.id, 'supervisor_analysis', 'supervisor', JSON.stringify({ tension_summary: 'x', followups: {} }), null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'financial', 'ر3.', null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'legal', 'ر4.', null, null);
  repos.council.appendRound(session.id, 'humanitarian_veto', 'humanitarian_aid', '❌ مرفوض: بند حساس — السبب: خطر إنساني حقيقي.', null, null);
  // The original (dead) process already logged this review to the audit trail once, for real, before crashing:
  repos.audit.logVeto('موضوع حساس آخر', 'humanitarian_aid', [{ item: 'بند حساس', reason: 'خطر إنساني حقيقي' }], '❌ مرفوض: بند حساس — السبب: خطر إنساني حقيقي.');

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.humanitarianVeto, 0, 'an already-persisted review must be reused verbatim, never re-run');
  const vetoLog = repos.audit.listVeto(20);
  assert.equal(vetoLog.length, 1, 'reusing a persisted review on resume must NOT duplicate the audit-trail entry');
  assert.ok(finalSession.finalOutput?.includes('التقرير التنفيذي النهائي'), 'synthesis still had to run fresh since it was never persisted');
});

test('a situation_room session with corrupted data (fewer than 2 participants) is marked FAILED safely on resume, not attempted', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'sr_corrupt', mode: 'situation_room', topic: 'موضوع فاسد', participantAgentIds: ['financial'], supervisorAgentId: 'supervisor' });
  assert.equal(session.participantAgentIds?.length, 1);

  await resumeInterruptedCouncilSessions();
  const finalSession = getCouncilSession(session.id)!;
  assert.equal(finalSession.state, 'FAILED');
  assert.match(finalSession.errorMessage ?? '', /ناقصة/);
  assert.equal(calls.round1 + calls.round2 + calls.supervisorAnalysis + calls.humanitarianVeto + calls.verification + calls.synthesis, 0);
});

test('a fresh (non-resumed) situation_room session with humanitarianVeto=false never runs or persists a humanitarian_veto round', async () => {
  const repos = getRepos();
  const session = repos.council.create({ id: 'sr_no_veto', mode: 'situation_room', topic: 'موضوع عادي', participantAgentIds: ['financial', 'legal'], supervisorAgentId: 'supervisor' });
  assert.equal(session.humanitarianVetoRequested, false);
  repos.council.appendRound(session.id, 'round1_opinion', 'financial', 'ر1.', null, null);
  repos.council.appendRound(session.id, 'round1_opinion', 'legal', 'ر2.', null, null);
  repos.council.appendRound(session.id, 'supervisor_analysis', 'supervisor', JSON.stringify({ tension_summary: 'x', followups: {} }), null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'financial', 'ر3.', null, null);
  repos.council.appendRound(session.id, 'round2_followup', 'legal', 'ر4.', null, null);

  await resumeInterruptedCouncilSessions();
  const finalSession = await waitForTerminal(session.id);

  assert.equal(finalSession.state, 'COMPLETED');
  assert.equal(calls.humanitarianVeto, 0);
  const rounds = repos.council.rounds(session.id);
  assert.ok(!rounds.some((r) => r.kind === 'humanitarian_veto'));
});
