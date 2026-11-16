import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { getRepos } from '../src/persistence/repos.js';
import { runChatCompletion } from '../src/orchestrator/chatService.js';
import { TaskObservability } from '../src/observability/recorder.js';
import { Verifier } from '../src/orchestrator/verifier.js';
import { EvaluationEngine } from '../src/evaluation/evaluationEngine.js';
import { proposeGenomeMutation } from '../src/evolution/agentGenome.js';
import { checkFreshness, refreshStaleItem } from '../src/knowledge/freshnessEngine.js';
import { AgentRegistry } from '../src/agents/agentRegistry.js';
import { NexusHttpError } from '../src/core/errors.js';
import { _resetRestrictedTasksForTests, decideCloudEgress } from '../src/security/cloudEgressGuard.js';
import { startFakeAnthropicServer } from './helpers/fakeAnthropicServer.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * GAP-1B suite (owner decision 2026-10-19): INTERNAL direct cloud calls — Verifier, EvaluationEngine, Digital Genome judge, Knowledge Freshness
 * classifier/research — must not bypass privacy restrictions. As in the GAP-1 suite, egress is measured at the FAKE cloud servers themselves
 * (requestLog / hit counters), never inferred from return values, and every "0 requests" assertion has a CONTROL beside it proving the same
 * call DOES reach the meter when it is allowed. Fake providers only — nothing here exercises a real Ollama, a real cloud API or a real network.
 */

const ctx: GatewayContext = { authenticated: true, clientKey: 'gap1b-test', projectId: null, userId: null };

let nexus: Server;
let nexusUrl: string;
let brokenLocal: Server;
let fakeGemini: Server;
let geminiHits = 0;
let cloud: Awaited<ReturnType<typeof startFakeAnthropicServer>>;

function listen(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    })
  );
}

const MARKER = 'CONFIDENTIAL-gap1b-7f31';

before(async () => {
  brokenLocal = createServer((_req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'local model server down' }));
  });
  process.env.NEXUS_OLLAMA_BASE_URL = await listen(brokenLocal);
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';

  fakeGemini = createServer(async (req, res) => {
    for await (const _ of req) void _;
    geminiHits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini answer' }] }, finishReason: 'STOP' }], usageMetadata: {} }));
  });
  process.env.NEXUS_GEMINI_BASE_URL = await listen(fakeGemini);
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';

  cloud = await startFakeAnthropicServer({
    respond: (body) => {
      const system = body.system ?? '';
      if (system.includes('مراجع مستقل صارم')) return { text: JSON.stringify({ verdict: 'ok', issues: [] }), stopReason: 'end_turn' };
      if (system.includes('محرك تقييم') || system.includes('حكم')) return { text: JSON.stringify({ verdict: 'SUPPORTED', confidence: 0.8, rationale: 'ok', supporting_count: 1, conflicting_count: 0 }), stopReason: 'end_turn' };
      return { text: JSON.stringify({ verdict: 'ok', issues: [], volatility: 'low', suggested_ttl_days: 365, rationale: 'x' }), stopReason: 'end_turn' };
    },
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = cloud.url;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  nexus = createNexusServer(); // initialises DB/repos
  nexusUrl = await listen(nexus);
});

after(async () => {
  await Promise.all([brokenLocal, fakeGemini, nexus].map((s) => new Promise((r) => s.close(r))));
  await new Promise((r) => cloud.server.close(r));
});

beforeEach(() => {
  _resetRestrictedTasksForTests();
});

function cloudCount(): number {
  return cloud.requestLog.length;
}

const evidence = [{ source: 'src', content: `evidence ${MARKER}`, kind: 'TOOL_RESULT' as const }];

function denyReasonFor(taskId: string): unknown {
  return getRepos().audit.listSecurity(500).find((r) => r.message === 'cloud_egress_denied' && r.meta.taskId === taskId)?.meta.reason;
}

/** Every persisted audit row must be free of the secret marker — the audit trail records decisions, never content. */
function assertAuditHasNoContent() {
  const rows = getRepos().audit.listSecurity(500);
  assert.ok(!JSON.stringify(rows).includes(MARKER), 'audit rows must never contain request content');
}

// ---- 1. the pure decision ----------------------------------------------------------------------------------------------------------------

test('[decision] restricted scopes are denied; open scopes and local providers are allowed; a request field can only tighten', () => {
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'anthropic' }), { allowed: true });
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'anthropic', privacyMode: 'BEST' }), { allowed: true });
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'anthropic', privacyMode: 'LOCAL_ONLY' }), { allowed: false, reason: 'privacy_mode' });
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'anthropic', privacyMode: 'PRIVATE' }), { allowed: false, reason: 'privacy_mode' });
  assert.deepEqual(decideCloudEgress({ purpose: 'genome_judge', provider: 'anthropic', agentMode: 'PRIVATE' }), { allowed: false, reason: 'agent_privacy_mode' });
  // a LOCAL provider is never blocked by this guard
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'ollama', privacyMode: 'PRIVATE' }), { allowed: true });
  // garbage / non-string values never widen or narrow anything
  assert.deepEqual(decideCloudEgress({ purpose: 'verification', provider: 'anthropic', privacyMode: { x: 1 } as unknown }), { allowed: true });
});

// ---- 2. Verifier ---------------------------------------------------------------------------------------------------------------------------

test('[Verifier] CONTROL: with no restriction the judge DOES reach the cloud meter', async () => {
  const before = cloudCount();
  const v = await Verifier.verify('سؤال', `إجابة ${MARKER}`);
  assert.equal(v.ran, true);
  assert.equal(cloudCount() - before, 1);
});

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[Verifier][${mode}] explicit privacy scope: fails closed, 0 cloud requests, distinct blockedReason`, async () => {
    const before = cloudCount();
    const v = await Verifier.verify('سؤال', `إجابة ${MARKER}`, { privacyMode: mode });
    assert.equal(v.ran, false);
    assert.equal(v.verdict, 'unavailable');
    assert.equal(v.blockedReason, 'cloud_egress_denied');
    assert.equal(cloudCount() - before, 0);
    assertAuditHasNoContent();
  });
}

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[Verifier][${mode}] task tainted by a privacy-mode chat call (local provider DOWN): verification of that task never reaches the cloud`, async () => {
    const taskId = `gap1b-task-${mode}`;
    const before = cloudCount();
    await assert.rejects(
      () => runChatCompletion({ mode, maxTokens: 50, messages: [{ role: 'user', content: `${MARKER}-${mode}` }], route: 'chat', taskId }, ctx, new TaskObservability(taskId, 'chat')),
      (e: unknown) => e instanceof NexusHttpError && e.code === 'local_provider_unavailable'
    );
    const v = await Verifier.verify('سؤال', `مخرجات ${MARKER}`, { taskId });
    assert.equal(v.ran, false);
    assert.equal(v.blockedReason, 'cloud_egress_denied');
    assert.equal(denyReasonFor(taskId), 'task_privacy_mode', 'the mode-based mark (strongest reason) is the one recorded');
    assert.equal(cloudCount() - before, 0, 'neither the failed local call nor the verifier may have sent anything to the cloud');
    assertAuditHasNoContent();
  });
}

test('[Verifier] task tainted by an EXPLICIT local provider (provider:"ollama", no mode) is restricted too', async () => {
  const taskId = 'gap1b-task-explicit-local';
  const before = cloudCount();
  await assert.rejects(
    () => runChatCompletion({ provider: 'ollama', maxTokens: 50, messages: [{ role: 'user', content: MARKER }], route: 'chat', taskId }, ctx, new TaskObservability(taskId, 'chat')),
    (e: unknown) => e instanceof NexusHttpError && e.code === 'local_provider_unavailable'
  );
  const v = await Verifier.verify('سؤال', MARKER, { taskId });
  assert.equal(v.blockedReason, 'cloud_egress_denied');
  assert.equal(denyReasonFor(taskId), 'task_local_provider');
  assert.equal(cloudCount() - before, 0);
});

test('[Verifier][LOCAL_ONLY] a privacy-mode request that FAILS AT ROUTING (no local provider can serve it) still marks the task — its intent was private', async () => {
  const taskId = 'gap1b-task-routing-fail';
  const before = cloudCount();
  // webSearch is a cloud-only capability, so LOCAL_ONLY routing throws before any provider is chosen.
  await assert.rejects(() =>
    runChatCompletion({ mode: 'LOCAL_ONLY', webSearch: true, maxTokens: 50, messages: [{ role: 'user', content: MARKER }], route: 'chat', taskId }, ctx, new TaskObservability(taskId, 'chat'))
  );
  const v = await Verifier.verify('سؤال', MARKER, { taskId });
  assert.equal(v.blockedReason, 'cloud_egress_denied');
  assert.equal(denyReasonFor(taskId), 'task_privacy_mode');
  assert.equal(cloudCount() - before, 0);
});

test('[Verifier] NOT over-blocking: a task that only used a CLOUD primary is still verified', async () => {
  const taskId = 'gap1b-task-open';
  await runChatCompletion({ provider: 'anthropic', maxTokens: 50, messages: [{ role: 'user', content: 'open request' }], route: 'chat', taskId }, ctx, new TaskObservability(taskId, 'chat'));
  const before = cloudCount();
  const v = await Verifier.verify('سؤال', 'إجابة', { taskId });
  assert.equal(v.ran, true);
  assert.equal(cloudCount() - before, 1);
});

test('[Verifier] the denial is audited with decision metadata only (purpose/provider/reason/taskId) and no content', async () => {
  const taskId = 'gap1b-audit-task';
  await Verifier.verify('سؤال', `إجابة ${MARKER}`, { taskId, privacyMode: 'PRIVATE' });
  const row = getRepos().audit.listSecurity(50).find((r) => r.message === 'cloud_egress_denied' && r.meta.taskId === taskId);
  assert.ok(row, 'a cloud_egress_denied audit row must exist');
  assert.equal(row!.meta.decision, 'deny');
  assert.equal(row!.meta.reason, 'privacy_mode');
  assert.equal(row!.meta.purpose, 'verification');
  assert.equal(row!.meta.provider, 'anthropic');
  assert.ok(typeof row!.createdAt === 'number' && row!.createdAt > 0, 'timestamp recorded');
  assertAuditHasNoContent();
});

// ---- 3. EvaluationEngine -------------------------------------------------------------------------------------------------------------------

test('[EvaluationEngine] CONTROL: unrestricted claim reaches the cloud judge', async () => {
  const before = cloudCount();
  const r = await EvaluationEngine.evaluate(`claim ${MARKER}`, evidence);
  assert.equal(r.ran, true);
  assert.equal(cloudCount() - before, 1);
});

test('[EvaluationEngine][PRIVATE] restricted claim: did-not-run, 0 cloud requests', async () => {
  const before = cloudCount();
  const r = await EvaluationEngine.evaluate(`claim ${MARKER}`, evidence, { privacyMode: 'PRIVATE' });
  assert.equal(r.ran, false);
  assert.equal(r.verdict, 'UNVERIFIED');
  assert.match(r.rationale, /مُنع الاتصال بالمزود السحابي/);
  assert.equal(cloudCount() - before, 0);
  assertAuditHasNoContent();
});

test('[HTTP /v2/evaluation/claim] privacyMode PRIVATE: 200 with ran:false, 0 cloud requests', async () => {
  const before = cloudCount();
  const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim: `claim ${MARKER}`, evidence, privacyMode: 'PRIVATE' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result?: { ran: boolean }; ran?: boolean };
  assert.equal((body.result ?? body).ran, false);
  assert.equal(cloudCount() - before, 0);
});

test('[HTTP bypass attempts] request fields / headers that try to re-enable cloud egress have NO effect on a restricted call', async () => {
  const before = cloudCount();
  for (const extra of [{ allowCloud: true }, { cloudFallback: true }, { allow_cloud_egress: true }, { cloudEgress: 'allow' }, { policy: { cloud: 'allow' } }, { approved: true, approval: 'granted' }]) {
    const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-nexus-allow-cloud': '1', 'x-cloud-egress': 'allow' },
      body: JSON.stringify({ claim: `claim ${MARKER}`, evidence, privacyMode: 'LOCAL_ONLY', ...extra }),
    });
    assert.equal(res.status, 200);
  }
  assert.equal(cloudCount() - before, 0, 'no combination of body fields/headers may open the cloud path');
});

test('[HTTP] a privacyMode value that is not LOCAL_ONLY/PRIVATE neither restricts nor widens (control for the field itself)', async () => {
  const before = cloudCount();
  const res = await fetch(`${nexusUrl}/v2/evaluation/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claim: `claim ${MARKER}`, evidence, privacyMode: 'BEST' }),
  });
  assert.equal(res.status, 200);
  assert.equal(cloudCount() - before, 1);
});

// ---- 4. Digital Genome judge ---------------------------------------------------------------------------------------------------------------

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[Genome][${mode}] an agent declared ${mode}: proposeGenomeMutation is refused with cloud_egress_denied, 0 cloud requests`, async () => {
    const def = AgentRegistry.get('financial');
    const original = def.models;
    getRepos().agentFailures.record({ agentId: 'financial', errorMessage: `failure mentioning ${MARKER}` });
    (def as { models: string }).models = mode;
    const before = cloudCount();
    try {
      await assert.rejects(
        () => proposeGenomeMutation('financial'),
        (e: unknown) => e instanceof NexusHttpError && e.code === 'cloud_egress_denied' && e.status === 403 && e.retryable === false
      );
    } finally {
      (def as { models: string }).models = original;
    }
    assert.equal(cloudCount() - before, 0);
    assert.equal(getRepos().agentGenomes.active('financial'), null);
    assertAuditHasNoContent();
  });
}

test('[Genome] CONTROL: the same agent with its normal (BEST) mode DOES reach the judge', async () => {
  const before = cloudCount();
  await proposeGenomeMutation('financial').catch(() => undefined); // result content is irrelevant here — only that the judge was contacted
  assert.ok(cloudCount() - before >= 1);
});

test('[HTTP /v2/evolution/.../propose] restricted agent => 403 cloud_egress_denied JSON error', async () => {
  const def = AgentRegistry.get('legal');
  const original = def.models;
  (def as { models: string }).models = 'PRIVATE';
  const before = cloudCount();
  try {
    const res = await fetch(`${nexusUrl}/v2/evolution/agents/legal/propose`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: { code: string; retryable: boolean } };
    assert.equal(body.error.code, 'cloud_egress_denied');
    assert.equal(body.error.retryable, false);
  } finally {
    (def as { models: string }).models = original;
  }
  assert.equal(cloudCount() - before, 0);
});

// ---- 5. Knowledge Freshness ----------------------------------------------------------------------------------------------------------------

function addItem() {
  return getRepos().memory.add({ projectId: null, userId: null, kind: 'knowledge', title: 'عنصر', content: `معلومة ${MARKER}`, embedding: null });
}

test('[Freshness] CONTROL: unrestricted check reaches the cloud classifier', async () => {
  const item = addItem();
  const before = cloudCount();
  await checkFreshness(item.id);
  assert.equal(cloudCount() - before, 1);
});

test('[Freshness][PRIVATE] restricted check: refused (403), no fake default classification stored, 0 cloud requests', async () => {
  const item = addItem();
  const before = cloudCount();
  await assert.rejects(
    () => checkFreshness(item.id, { privacyMode: 'PRIVATE' }),
    (e: unknown) => e instanceof NexusHttpError && e.code === 'cloud_egress_denied'
  );
  assert.equal(cloudCount() - before, 0);
  assert.equal(getRepos().knowledgeFreshness.latestForItem(item.id), null);
  assertAuditHasNoContent();
});

test('[Freshness][LOCAL_ONLY] restricted refresh: refused BEFORE web research — neither the cloud judge nor Gemini research is contacted', async () => {
  const item = addItem();
  const check = await checkFreshness(item.id); // an ordinary check first, to have a row to refresh
  const beforeCloud = cloudCount();
  const beforeGemini = geminiHits;
  await assert.rejects(
    () => refreshStaleItem(check.id, ctx, { privacyMode: 'LOCAL_ONLY' }),
    (e: unknown) => e instanceof NexusHttpError && e.code === 'cloud_egress_denied'
  );
  assert.equal(cloudCount() - beforeCloud, 0);
  assert.equal(geminiHits - beforeGemini, 0);
});

test('[HTTP freshness routes] privacyMode in the body: check => 403, scan => 403 when there is an item to check, no cloud traffic', async () => {
  const item = addItem();
  const before = cloudCount();
  const r1 = await fetch(`${nexusUrl}/v2/knowledge-freshness/items/${item.id}/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacyMode: 'PRIVATE' }) });
  assert.equal(r1.status, 403);
  assert.equal(((await r1.json()) as { error: { code: string } }).error.code, 'cloud_egress_denied');
  const r2 = await fetch(`${nexusUrl}/v2/knowledge-freshness/scan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privacyMode: 'LOCAL_ONLY', limit: 5 }) });
  assert.equal(r2.status, 403);
  assert.equal(cloudCount() - before, 0);
});

test('[HTTP freshness] a check request with NO body still works exactly as before (contract compatibility)', async () => {
  const item = addItem();
  const before = cloudCount();
  const res = await fetch(`${nexusUrl}/v2/knowledge-freshness/items/${item.id}/check`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal(cloudCount() - before, 1);
});
