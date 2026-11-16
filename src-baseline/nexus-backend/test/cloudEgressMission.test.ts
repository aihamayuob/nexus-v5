import './helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { createMission, runMission } from '../src/orchestrator/missionRunner.js';
import { runCouncilSession, getCouncilSession } from '../src/council/councilRunner.js';
import { AgentRegistry } from '../src/agents/agentRegistry.js';
import { _resetRestrictedTasksForTests } from '../src/security/cloudEgressGuard.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * GAP-1B end-to-end through the REAL missionRunner: the mission's only agent is declared LOCAL_ONLY and a HEALTHY local provider serves it.
 * The mission asks for verification. The fake cloud judge must receive ZERO verifier requests (the judge is a direct cloud call that used to
 * ignore privacy entirely), while a control mission with a BEST agent DOES send them.
 *
 * What this file does NOT claim (see the GAP-1B report): the mission's planning call, reflection and synthesis go through BEST/supervisor routing and
 * are a separate, still-PENDING question (taint propagation inside a mission). Only the verifier request count is asserted here.
 */

const ctx: GatewayContext = { authenticated: true, clientKey: 'gap1b-mission', projectId: null, userId: null };
const MARKER = 'CONFIDENTIAL-mission-4b9e';

let cloud: Server;
let local: Server;
let verifierHits = 0;
let localHits = 0;

function listen(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    })
  );
}

function anthropicText(text: string) {
  return JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
}
function sse(res: import('node:http').ServerResponse, text: string) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const f = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  f('message_start', { type: 'message_start', message: { usage: { input_tokens: 10 } } });
  f('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
  f('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  f('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 10 } });
  f('message_stop', { type: 'message_stop' });
  res.end();
}

before(async () => {
  cloud = createServer(async (req, res) => {
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
      res.end(anthropicText(JSON.stringify({ tasks: [{ id: 'only_task', description: 'أنجز المهمة الوحيدة', dependsOn: [] }] })));
      return;
    }
    if (system.includes('أنت مراجع مستقل صارم')) {
      verifierHits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicText(JSON.stringify({ verdict: 'ok', issues: [] })));
      return;
    }
    if (system.includes('أنت مراجع ذاتي صارم')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(anthropicText(JSON.stringify({ verdict: 'ok' })));
      return;
    }
    if (body.stream) return sse(res, 'مخرجات سحابية');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(anthropicText('مخرجات سحابية'));
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(cloud);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  // A HEALTHY local provider (lmstudio-style, OpenAI-compatible). Ollama is deliberately NOT configured in this file.
  local = createServer(async (req, res) => {
    for await (const _ of req) void _;
    localHits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: `ناتج محلي ${MARKER}` }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
  });
  process.env.NEXUS_LMSTUDIO_BASE_URL = await listen(local);
  process.env.NEXUS_MODEL_LMSTUDIO = 'local-model';
});

after(async () => {
  cloud.closeAllConnections();
  await Promise.all([cloud, local].map((s) => new Promise((r) => s.close(r))));
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
  _resetRestrictedTasksForTests();
  verifierHits = 0;
  localHits = 0;
});

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[mission][${mode}] a mission whose agent is ${mode}: the cloud verifier receives 0 requests (even with requireVerificationOk)`, async () => {
    const def = AgentRegistry.get('general');
    const original = def.models;
    (def as { models: string }).models = mode;
    try {
      const { missionId } = createMission('اكتب ملخصاً', ctx, { completionCriteria: { runVerification: true, requireVerificationOk: true } });
      await runMission(missionId, ctx);
      const mission = getRepos().missions.get(missionId)!;
      assert.ok(localHits >= 1, 'the LOCAL agent really ran on the healthy local provider');
      assert.equal(verifierHits, 0, 'the cloud judge must not have been contacted');
      const verification = mission.result?.verification as { ran: boolean; blockedReason?: string } | null | undefined;
      assert.equal(verification?.ran, false);
      assert.equal(verification?.blockedReason, 'cloud_egress_denied');
      // requireVerificationOk is set and verification did not run => the mission must NOT be reported as having been verified.
      assert.notEqual(mission.state, 'COMPLETED', 'unverified output must not satisfy requireVerificationOk');
      const rows = JSON.stringify(getRepos().audit.listSecurity(200));
      assert.ok(rows.includes('cloud_egress_denied'));
      assert.ok(!rows.includes(MARKER), 'audit rows carry decisions only, never content');
    } finally {
      (def as { models: string }).models = original;
    }
  });
}

test('[mission] CONTROL: the same mission with the default (BEST) agent DOES send verifier requests to the cloud', async () => {
  const { missionId } = createMission('اكتب ملخصاً', ctx, { completionCriteria: { runVerification: true, requireVerificationOk: true } });
  await runMission(missionId, ctx);
  assert.ok(verifierHits >= 1, 'the egress meter is live: an unrestricted mission does reach the judge');
  assert.equal(getRepos().missions.get(missionId)!.state, 'COMPLETED');
});

async function waitForCouncil(sessionId: string) {
  for (let i = 0; i < 400; i++) {
    const s = getCouncilSession(sessionId);
    if (s && (s.state === 'COMPLETED' || s.state === 'FAILED')) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('council session did not reach a terminal state');
}

test('[council][PRIVATE] cross-exam with PRIVATE proposer+critic: the independent-verification round does NOT reach the cloud judge and records why', async () => {
  const defs = ['financial', 'legal'].map((id) => AgentRegistry.get(id));
  const originals = defs.map((d) => d.models);
  defs.forEach((d) => ((d as { models: string }).models = 'PRIVATE'));
  try {
    const { sessionId } = await runCouncilSession({ topic: `موضوع ${MARKER}`, proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
    const session = await waitForCouncil(sessionId);
    assert.equal(verifierHits, 0, 'the cloud judge must not have been contacted');
    assert.ok(localHits >= 3, 'the PRIVATE agents really ran on the healthy local provider');
    const verification = getRepos().council.rounds(sessionId).find((r) => r.kind === 'verification');
    assert.ok(verification, 'the verification round is still recorded (as did-not-run), not silently skipped');
    assert.match(verification!.content, /cloud egress denied by privacy policy/);
    void session;
  } finally {
    defs.forEach((d, i) => ((d as { models: string }).models = originals[i]!));
  }
});

test('[council] CONTROL: the same cross-exam with default (BEST) agents DOES hit the cloud judge', async () => {
  const { sessionId } = await runCouncilSession({ topic: 'موضوع عادي', proposerAgentId: 'financial', criticAgentId: 'legal' }, ctx);
  await waitForCouncil(sessionId);
  assert.ok(verifierHits >= 1);
});
