import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createMission, runMission } from '../src/orchestrator/missionRunner.js';
import { decideApproval } from '../src/orchestrator/approvalGate.js';
import { runCouncilSession } from '../src/council/councilRunner.js';
import { Warden } from '../src/warden/warden.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let behavior: { verifierVerdict: { verdict: 'ok' | 'issues_found'; issues: string[] }; hangForever: boolean };

function resetBehavior() {
  behavior = { verifierVerdict: { verdict: 'ok', issues: [] }, hangForever: false };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

function writeAnthropicSse(res: import('node:http').ServerResponse, text: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const frame = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } });
  frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
  frame('message_stop', { type: 'message_stop' });
  res.end();
}

before(async () => {
  server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    if (behavior.hangForever) return;
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
    if (system.includes('أنت مراجع مستقل صارم')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify(behavior.verifierVerdict)));
      return;
    }
    if (body.stream) {
      writeAnthropicSse(res, 'ناتج نهائي قابل للمراجعة.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('ناتج نهائي قابل للمراجعة.'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  process.env.NEXUS_ANTHROPIC_BASE_URL = serverUrl;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
});

after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  freshDb();
  resetBehavior();
});

// ---- Warden.cancelMission / cancelCouncilSession -----------------------

test('Warden.cancelMission cancels a real running mission and records an audit event', async () => {
  behavior.hangForever = true;
  const { missionId } = createMission('مهمة معلّقة للاختبار', ctx);
  const runPromise = runMission(missionId, ctx);
  await new Promise((r) => setTimeout(r, 150));

  const { cancelled } = Warden.cancelMission(missionId, 'اختبار الإلغاء المُدقَّق');
  assert.equal(cancelled, true);
  await runPromise;

  const mission = getRepos().missions.get(missionId);
  assert.equal(mission!.state, 'CANCELLED');

  const events = getRepos().audit.listSecurity(20);
  const wardenEvent = events.find((e) => e.message.includes('Warden: mission cancellation requested'));
  assert.ok(wardenEvent, 'expected a real audited Warden cancellation event');
  assert.equal((wardenEvent!.meta as { missionId: string }).missionId, missionId);
});

test('Warden.cancelMission on an unknown mission id throws not_found, not a silent no-op', () => {
  assert.throws(() => Warden.cancelMission('does-not-exist', 'x'), /Mission غير موجودة/);
});

test('Warden.cancelCouncilSession cancels a real running session and records an audit event', async () => {
  behavior.hangForever = true;
  const { sessionId } = await runCouncilSession({ topic: 'جلسة معلّقة', proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
  await new Promise((r) => setTimeout(r, 150));

  const { cancelled } = Warden.cancelCouncilSession(sessionId, 'اختبار');
  assert.equal(cancelled, true);
  await new Promise((r) => setTimeout(r, 100));

  const events = getRepos().audit.listSecurity(20);
  assert.ok(events.some((e) => e.message.includes('Warden: council session cancellation requested')));
});

test('Warden.cancelCouncilSession on an unknown session id throws not_found', () => {
  assert.throws(() => Warden.cancelCouncilSession('does-not-exist', 'x'), /جلسة المجلس غير موجودة/);
});

// ---- Warden.status() ----------------------------------------------------

test('Warden.status() reflects a real active mission count, then drops to zero once it completes', async () => {
  const before1 = Warden.status();
  assert.equal(before1.activeMissions, 0);

  behavior.hangForever = true; // guarantee the mission is still non-terminal when we check, same pattern as the cancellation tests above
  const { missionId } = createMission('مهمة لقياس الحالة', ctx);
  const runPromise = runMission(missionId, ctx);
  await new Promise((r) => setTimeout(r, 100));
  const mid = Warden.status();
  assert.ok(mid.activeMissions >= 1);

  Warden.cancelMission(missionId, 'إنهاء بعد قياس الحالة');
  await runPromise;
  const after1 = Warden.status();
  assert.equal(after1.activeMissions, 0);
  assert.equal(typeof after1.budget.enabled, 'boolean');
});

// ---- requireApprovalOnIssues: real human-in-the-loop gating -------------

test('a mission with requireApprovalOnIssues=true and a final issues_found verdict is held in AWAITING_APPROVAL, not auto-completed', async () => {
  behavior.verifierVerdict = { verdict: 'issues_found', issues: ['خطر لم تتم معالجته'] };
  const { missionId } = createMission('مهمة تتطلب موافقة بشرية', ctx, {
    completionCriteria: { requireApprovalOnIssues: true },
  });
  await runMission(missionId, ctx);

  const mission = getRepos().missions.get(missionId)!;
  assert.equal(mission.state, 'AWAITING_APPROVAL');
  assert.ok(mission.result?.finalOutput);

  const pending = getRepos().approvals.get(missionId);
  assert.equal(pending?.status, 'pending');
});

test('approving a mission held in AWAITING_APPROVAL transitions it to COMPLETED via the existing approvalGate flow', async () => {
  behavior.verifierVerdict = { verdict: 'issues_found', issues: ['ملاحظة'] };
  const { missionId } = createMission('مهمة ستُوافَق عليها', ctx, { completionCriteria: { requireApprovalOnIssues: true } });
  await runMission(missionId, ctx);
  assert.equal(getRepos().missions.get(missionId)!.state, 'AWAITING_APPROVAL');

  const result = decideApproval(missionId, 'approved', 'reviewer_1');
  assert.ok(result.finalOutput);

  const mission = getRepos().missions.get(missionId)!;
  assert.equal(mission.state, 'COMPLETED');
  assert.ok(mission.completedAt);
});

test('rejecting a mission held in AWAITING_APPROVAL transitions it to FAILED, not silently discarded', async () => {
  behavior.verifierVerdict = { verdict: 'issues_found', issues: ['ملاحظة'] };
  const { missionId } = createMission('مهمة سترفض', ctx, { completionCriteria: { requireApprovalOnIssues: true } });
  await runMission(missionId, ctx);

  decideApproval(missionId, 'rejected', 'reviewer_2');
  const mission = getRepos().missions.get(missionId)!;
  assert.equal(mission.state, 'FAILED');
});

test('a plain task approval (non-mission taskId) is completely unaffected by the new mission-sync logic — regression', async () => {
  // requestApproval()/decideApproval() predate missions entirely (plain HIGH_RISK tasks) — confirm the additive mission-lookup in decideApproval() is a true no-op when repos.missions.get() returns null.
  const { requestApproval } = await import('../src/orchestrator/approvalGate.js');
  const { claimTask } = await import('../src/orchestrator/taskManager.js');
  const { taskId } = claimTask('runtime_plan', null, ctx, {});
  requestApproval(taskId, 'مسودة', 'اختبار');
  const result = decideApproval(taskId, 'approved', 'reviewer_3');
  assert.ok(result.finalOutput !== undefined);
  assert.equal(getRepos().missions.get(taskId), null);
});

// ---- Warden HTTP status route is exercised separately in test/wardenRoutes.test.ts
