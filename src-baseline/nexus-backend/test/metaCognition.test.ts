import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createMission, runMission } from '../src/orchestrator/missionRunner.js';
import { reviewMission, detectRepeatedFailurePatterns } from '../src/metacognition/metaCognition.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

let server: Server;
let serverUrl: string;
let behavior: { reviewResponse: string };

function resetBehavior() {
  behavior = {
    reviewResponse: JSON.stringify({
      findings: [
        { category: 'agent_selection', observation: 'اختيار الوكيل العام بدل متخصص كان غير مثالي لطبيعة المهمة.', suggested_change: 'استخدم selectAgentForTask بدل الوكيل الافتراضي.' },
      ],
    }),
  };
}

function anthropicTextResponse(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}

before(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { system?: string; messages?: Array<{ content?: string }>; stream?: boolean } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    } catch {
      /* ignore */
    }
    const system = body.system ?? '';
    const userMsg = body.messages?.[0]?.content ?? '';

    if (system.includes('أنت مخطط مهام')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ tasks: [{ id: 'only_task', description: 'أنجز المهمة', dependsOn: [] }] })));
      return;
    }
    if (system.includes('مراجع مستقل صارم')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(JSON.stringify({ verdict: 'ok', issues: [] })));
      return;
    }
    if (userMsg.includes('وضع "تراجع ما بعد التنفيذ"')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicTextResponse(behavior.reviewResponse));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const frame = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      frame('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } });
      frame('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
      frame('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ناتج المهمة النهائي.' } });
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
      frame('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicTextResponse('ناتج المهمة النهائي.'));
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

async function completedMission(): Promise<string> {
  const { missionId } = createMission('مهمة حقيقية لاختبار المراجعة اللاحقة', ctx);
  await runMission(missionId, ctx);
  return missionId;
}

test('reviewMission rejects reviewing a mission that is still running (non-terminal state)', async () => {
  const { missionId } = createMission('مهمة قيد التنفيذ', ctx);
  // deliberately NOT awaited — mission is likely still PLANNING/RUNNING
  const runPromise = runMission(missionId, ctx);
  await assert.rejects(() => reviewMission(missionId, ctx), /لا يمكن مراجعة مهمة لا تزال في حالة/);
  await runPromise; // let it finish so it doesn't leak into the next test
});

test('reviewMission on an unknown mission id is a real not_found, not a crash', async () => {
  await assert.rejects(() => reviewMission('does-not-exist', ctx), /Mission غير موجودة/);
});

test('reviewMission on a real completed mission produces a real, structured, persisted proposal', async () => {
  const missionId = await completedMission();
  const proposals = await reviewMission(missionId, ctx);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.subjectType, 'mission');
  assert.equal(proposals[0]!.subjectId, missionId);
  assert.equal(proposals[0]!.category, 'agent_selection');
  assert.equal(proposals[0]!.status, 'open');
  assert.match(proposals[0]!.observation, /اختيار الوكيل العام/);

  // actually persisted, not just returned in memory
  const listed = getRepos().improvementProposals.list({ subjectType: 'mission' });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.id, proposals[0]!.id);
});

test('reviewMission that genuinely finds nothing creates ZERO proposals — not fabricated filler', async () => {
  behavior.reviewResponse = JSON.stringify({ findings: [] });
  const missionId = await completedMission();
  const proposals = await reviewMission(missionId, ctx);
  assert.equal(proposals.length, 0);
  assert.equal(getRepos().improvementProposals.list().length, 0);
});

test('reviewMission on a malformed (unparseable) response persists ONE raw fallback proposal rather than losing the real API call', async () => {
  behavior.reviewResponse = 'هذا ليس JSON صالحاً إطلاقاً، فقط نص عادي.';
  const missionId = await completedMission();
  const proposals = await reviewMission(missionId, ctx);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0]!.category, 'other');
  assert.match(proposals[0]!.suggestedChange, /ليس JSON صالحاً/);
});

test('detectRepeatedFailurePatterns is a REAL deterministic aggregation over agent_failures — zero LLM calls', () => {
  const repos = getRepos();
  for (let i = 0; i < 4; i++) {
    repos.agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل رقم ${i}` });
  }
  repos.agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: 'فشل واحد فقط' });

  const proposals = detectRepeatedFailurePatterns(60 * 60 * 1000, 3);
  assert.equal(proposals.length, 1, 'only financial (4 failures) crosses the minCount=3 threshold, not legal (1 failure)');
  assert.equal(proposals[0]!.subjectType, 'failure_pattern');
  assert.equal(proposals[0]!.subjectId, 'financial');
  assert.match(proposals[0]!.observation, /فشل 4 مرة/);
});

test('detectRepeatedFailurePatterns does not spam duplicate proposals for a pattern that already has an open proposal', () => {
  const repos = getRepos();
  for (let i = 0; i < 5; i++) {
    repos.agentFailures.record({ agentId: 'financial', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل ${i}` });
  }
  const first = detectRepeatedFailurePatterns(60 * 60 * 1000, 3);
  assert.equal(first.length, 1);
  const second = detectRepeatedFailurePatterns(60 * 60 * 1000, 3);
  assert.equal(second.length, 0, 'the same still-open pattern must not be re-flagged');
  assert.equal(getRepos().improvementProposals.list({ subjectType: 'failure_pattern' }).length, 1);
});

test('detectRepeatedFailurePatterns respects the time window — old failures outside windowMs are not counted', async () => {
  const repos = getRepos();
  for (let i = 0; i < 4; i++) {
    repos.agentFailures.record({ agentId: 'legal', missionId: null, taskNodeId: null, provider: 'anthropic', errorMessage: `فشل ${i}` });
  }
  await new Promise((r) => setTimeout(r, 60)); // guarantee real, reliable elapsed time — a bare windowMs=1 is racy against sub-millisecond synchronous execution
  const proposals = detectRepeatedFailurePatterns(20, 3); // 20ms window — the failures recorded 60ms ago are definitively outside it
  assert.equal(proposals.length, 0);
});
