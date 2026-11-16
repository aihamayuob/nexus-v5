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
let behavior: { vetoText: string };

function resetBehavior() {
  behavior = {
    vetoText:
      'راجعت النقاش. ❌ مرفوض: نقل الأسلحة عبر ممرات إنسانية — السبب: يعرض طواقم الإغاثة للخطر ويخالف مبدأ الحياد الإنساني.\nباقي البنود مقبولة إنسانياً.',
  };
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
    if (userMsg.includes('tension_summary')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ tension_summary: 'لا تعارض كبير.', followups: { financial: 'تابع.', legal: 'تابع.' } })));
      return;
    }
    if (userMsg.includes('من منظورك الإنساني/الأخلاقي البحت')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(behavior.vetoText));
      return;
    }
    if (userMsg.includes('تقريراً تنفيذياً')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse('التقرير النهائي.\n\n🕊️ بنود مستبعدة (فيتو إنساني)\nنقل الأسلحة — مرفوض بناءً على المراجعة.'));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('رأي متخصص حقيقي.'));
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
  throw new Error('timed out waiting for terminal state');
}

test('humanitarianVeto:false (the default) never runs a veto round or touches the audit log — regression for every existing situation_room caller', async () => {
  const { sessionId } = await runCouncilSession({ mode: 'situation_room', topic: 'موضوع عادي', participantAgentIds: ['financial', 'legal'] }, ctx);
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED');
  const rounds = getRepos().council.rounds(sessionId);
  assert.ok(!rounds.some((r) => r.kind === 'humanitarian_veto'));
  assert.equal(getRepos().audit.listVeto(10).length, 0);
});

test('humanitarianVeto:true runs a real review round, parses real "❌ مرفوض" items, and writes them to the ALREADY-EXISTING audit-veto trail', async () => {
  const { sessionId } = await runCouncilSession(
    { mode: 'situation_room', topic: 'خطة إغاثة في منطقة نزاع', participantAgentIds: ['financial', 'legal'], humanitarianVeto: true },
    ctx
  );
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED');

  const rounds = getRepos().council.rounds(sessionId);
  const vetoRound = rounds.find((r) => r.kind === 'humanitarian_veto');
  assert.ok(vetoRound, 'expected a real humanitarian_veto round to be persisted');
  assert.equal(vetoRound!.agentId, 'humanitarian_aid'); // real precedence: humanitarian_aid before conflict_resolution
  assert.match(vetoRound!.content, /نقل الأسلحة/);

  // the pre-existing AuditRepo.logVeto()/listVeto() infrastructure (routes/legacy/auditVeto.ts) actually got a real caller for the first time
  const vetoEvents = getRepos().audit.listVeto(10);
  assert.equal(vetoEvents.length, 1);
  assert.equal(vetoEvents[0]!.reviewerAgentId, 'humanitarian_aid');
  assert.equal(vetoEvents[0]!.rejectedItems.length, 1);
  assert.match(vetoEvents[0]!.rejectedItems[0]!.item, /نقل الأسلحة/);
  assert.match(vetoEvents[0]!.rejectedItems[0]!.reason, /الحياد الإنساني/);

  // the final synthesis actually reflects the exclusion, not just the raw review being logged
  assert.match(session.finalOutput ?? '', /بنود مستبعدة/);
});

test('humanitarianVeto:true with a review that flags NOTHING logs a real (empty) audit event but injects no exclusion instruction', async () => {
  behavior.vetoText = 'راجعت النقاش الكامل من منظور إنساني. لا يوجد أي بند مرفوض في هذه الحالة.';
  const { sessionId } = await runCouncilSession(
    { mode: 'situation_room', topic: 'موضوع لا يثير مخاوف إنسانية', participantAgentIds: ['financial', 'legal'], humanitarianVeto: true },
    ctx
  );
  const session = await waitForTerminal(sessionId);
  assert.equal(session.state, 'COMPLETED');
  const vetoEvents = getRepos().audit.listVeto(10);
  assert.equal(vetoEvents.length, 1);
  assert.equal(vetoEvents[0]!.rejectedItems.length, 0, 'a real review that found nothing should log zero rejected items, not fabricate any');
});

test('parseVetoRejectedItems-equivalent regex correctly extracts MULTIPLE real rejected items from one review', async () => {
  behavior.vetoText =
    '❌ مرفوض: البند الأول — السبب: سبب الأول.\nنص وسط عادي.\n❌ مرفوض: البند الثاني — السبب: سبب الثاني.';
  const { sessionId } = await runCouncilSession(
    { mode: 'situation_room', topic: 'اختبار بندين مرفوضين', participantAgentIds: ['financial', 'legal'], humanitarianVeto: true },
    ctx
  );
  await waitForTerminal(sessionId);
  const vetoEvents = getRepos().audit.listVeto(10);
  assert.equal(vetoEvents[0]!.rejectedItems.length, 2);
  assert.equal(vetoEvents[0]!.rejectedItems[0]!.item, 'البند الأول');
  assert.equal(vetoEvents[0]!.rejectedItems[1]!.item, 'البند الثاني');
});
