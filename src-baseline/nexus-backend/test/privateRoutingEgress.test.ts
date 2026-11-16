import './helpers/setFallbackTestEnv.js';
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { selectProviderForMode } from '../src/providers/routingModes.js';
import { routeModel } from '../src/providers/modelRouter.js';
import { runChatCompletion } from '../src/orchestrator/chatService.js';
import { TaskObservability } from '../src/observability/recorder.js';
import { ProviderRegistry } from '../src/config/providerRegistry.js';
import { NexusHttpError } from '../src/core/errors.js';
import { startFakeAnthropicServer } from './helpers/fakeAnthropicServer.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

/**
 * GAP-1 regression suite (owner decisions D1/D2, 2026-10-18): a request routed to a LOCAL provider — through LOCAL_ONLY / PRIVATE mode OR an
 * explicit local choice such as provider:"ollama" — must never reach a CLOUD provider when the local one fails. Egress is measured at the
 * fake cloud server itself (requestLog), never inferred from the router's own return value alone: a primary-provider-succeeds test proves
 * nothing about this policy, so every "no egress" test here makes the LOCAL provider fail while a healthy cloud server is available.
 */

const ctx: GatewayContext = { authenticated: true, clientKey: 'privacy-egress-test', projectId: null, userId: null };

let nexus: Server;
let nexusUrl: string;
let brokenLocal: Server;
let healthyLmStudio: Server;
let lmStudioHits = 0;
let cloud: Awaited<ReturnType<typeof startFakeAnthropicServer>>;
let openaiCloud: Server;
let ollamaHits = 0;

function listen(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    })
  );
}

function cloudRequestsSince(n: number): unknown[] {
  return cloud.requestLog.slice(n);
}

before(async () => {
  // LOCAL provider (ollama): configured, but ALWAYS fails with a retryable 503.
  brokenLocal = createServer((_req, res) => {
    ollamaHits++;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'local model server down' }));
  });
  process.env.NEXUS_OLLAMA_BASE_URL = await listen(brokenLocal);
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';

  // A second LOCAL provider (lmstudio) that WORKS — only enabled by the one test that needs it.
  healthyLmStudio = createServer(async (req, res) => {
    for await (const _ of req) void _;
    lmStudioHits++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'answered by the SECOND LOCAL provider' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4 } }));
  });
  process.env.NEXUS_LMSTUDIO_BASE_URL = await listen(healthyLmStudio);

  // CLOUD providers: healthy, and the anthropic one RECORDS every request it receives (the egress meter).
  cloud = await startFakeAnthropicServer({ respond: () => ({ text: 'cloud answered', stopReason: 'end_turn' }) });
  process.env.NEXUS_ANTHROPIC_BASE_URL = cloud.url;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
  openaiCloud = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
  });
  process.env.NEXUS_OPENAI_BASE_URL = await listen(openaiCloud);
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key';

  nexus = createNexusServer(); // initialises DB/repos exactly as the real suites do
  nexusUrl = await listen(nexus);
});

afterEach(() => {
  delete process.env.NEXUS_MODEL_LMSTUDIO; // lmstudio is only "configured" inside the one test that sets it
});

after(async () => {
  await Promise.all([brokenLocal, healthyLmStudio, openaiCloud, nexus].map((s) => new Promise((r) => s.close(r))));
  await new Promise((r) => cloud.server.close(r));
});

// ---- 1. Router level: the fallback chain itself -------------------------------------------------------------------------------------------

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[${mode}] the routed fallback chain contains ONLY local providers and flags cloud fallback as blocked`, async () => {
    const routed = await selectProviderForMode({ mode });
    assert.equal(routed.provider, 'ollama');
    const nonLocal = routed.fallbacks.filter((id) => !ProviderRegistry.resolve(id).capabilities.isLocal);
    assert.deepEqual(nonLocal, [], 'a privacy mode must never list a cloud provider as a fallback');
    assert.equal(routed.cloudFallbackBlocked, true);
  });
}

test('an explicit local provider (USER_SELECTED / routeModel) has NO cloud fallback by default', () => {
  const routed = routeModel('ollama');
  assert.deepEqual(routed.fallbacks.filter((id) => !ProviderRegistry.resolve(id).capabilities.isLocal), []);
  assert.equal(routed.cloudFallbackBlocked, true);
});

test('local -> local fallback is still allowed (the policy blocks cloud egress, not resilience)', () => {
  process.env.NEXUS_MODEL_LMSTUDIO = 'some-local-model';
  const routed = routeModel('ollama');
  assert.deepEqual(routed.fallbacks, ['lmstudio']);
});

test('a CLOUD primary keeps its existing fallback chain (no over-blocking of normal cloud routing)', () => {
  const routed = routeModel('anthropic');
  assert.equal(routed.cloudFallbackBlocked, false);
  assert.ok(routed.fallbacks.includes('openai'), `cloud primary lost its cloud fallback: ${JSON.stringify(routed.fallbacks)}`);
});

// ---- 2. End to end through runChatCompletion: the local provider FAILS while a healthy cloud server is available ---------------------------

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[${mode}] local provider fails => clear local_provider_unavailable error and ZERO requests reach the cloud (marker never leaves)`, async () => {
    const marker = `CONFIDENTIAL-${mode}-e2e-7f3a`;
    const before = cloud.requestLog.length;
    await assert.rejects(
      () =>
        runChatCompletion(
          { mode, maxTokens: 50, messages: [{ role: 'user', content: `${marker}: summarise this private note` }], route: 'chat', taskId: `egress-${mode}` },
          ctx,
          new TaskObservability(`egress-${mode}`, 'chat')
        ),
      (e: unknown) => {
        assert.ok(e instanceof NexusHttpError, 'expected a NexusHttpError');
        assert.equal(e.code, 'local_provider_unavailable');
        assert.equal(e.status, 503);
        assert.equal(e.details?.localProvider, 'ollama');
        assert.equal(e.details?.cloudFallback, 'blocked');
        return true;
      }
    );
    const received = cloudRequestsSince(before);
    assert.equal(received.length, 0, 'the cloud provider received a request that was supposed to stay local');
    assert.ok(!JSON.stringify(received).includes(marker));
  });
}

test('[PRIVATE, streaming handlers] same guarantee on the streaming path', async () => {
  const marker = 'CONFIDENTIAL-stream-4b2e';
  const before = cloud.requestLog.length;
  await assert.rejects(
    () =>
      runChatCompletion(
        { mode: 'PRIVATE', maxTokens: 50, messages: [{ role: 'user', content: `${marker}: private` }], route: 'chat', taskId: 'egress-stream' },
        ctx,
        new TaskObservability('egress-stream', 'chat'),
        { onToken: () => {} }
      ),
    (e: unknown) => e instanceof NexusHttpError && e.code === 'local_provider_unavailable'
  );
  assert.equal(cloudRequestsSince(before).length, 0);
});

test('local -> local fallback works end to end and still sends nothing to the cloud', async () => {
  process.env.NEXUS_MODEL_LMSTUDIO = 'some-local-model';
  const before = cloud.requestLog.length;
  const lmBefore = lmStudioHits;
  const r = await runChatCompletion(
    { provider: 'ollama', maxTokens: 50, messages: [{ role: 'user', content: 'CONFIDENTIAL-local2local-1d9c' }], route: 'chat', taskId: 'egress-l2l' },
    ctx,
    new TaskObservability('egress-l2l', 'chat')
  );
  assert.equal(r.providerUsed, 'lmstudio');
  assert.ok(lmStudioHits > lmBefore, 'the second local provider must have served the request');
  assert.equal(cloudRequestsSince(before).length, 0);
});

// ---- 3. The real HTTP surface the frontend uses --------------------------------------------------------------------------------------------

test('[HTTP /api/chat provider=ollama] explicit local choice, local down => 503 local_provider_unavailable, nothing reaches the cloud', async () => {
  const marker = 'CONFIDENTIAL-http-9c1d';
  const before = cloud.requestLog.length;
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'ollama', max_tokens: 50, messages: [{ role: 'user', content: `${marker}: private note` }] }),
  });
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
  assert.equal(body.error.code, 'local_provider_unavailable');
  assert.match(body.error.message, /لم يُرسَل أي محتوى إلى مزود سحابي/);
  assert.equal(cloudRequestsSince(before).length, 0);
});

test('[HTTP /api/chat provider=ollama, stream:true] streaming route: error event, nothing reaches the cloud', async () => {
  const before = cloud.requestLog.length;
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'ollama', stream: true, max_tokens: 50, messages: [{ role: 'user', content: 'CONFIDENTIAL-http-stream-6a8f: private' }] }),
  });
  const text = await res.text(); // the SSE stream is closed by the route once the task ends
  assert.match(text, /event: error/);
  assert.match(text, /المزود المحلي/);
  assert.equal(cloudRequestsSince(before).length, 0);
});

// ---- 4. Control: proves the egress meter is not blind (otherwise "0 requests" above would prove nothing) ---------------------------------------

test('CONTROL: an explicit CLOUD request does register on the egress meter', async () => {
  const before = cloud.requestLog.length;
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'anthropic', max_tokens: 50, messages: [{ role: 'user', content: 'CONTROL-cloud-request-2e7b' }] }),
  });
  assert.equal(res.status, 200);
  assert.equal(cloudRequestsSince(before).length, 1);
});

test('the local provider really was attempted in the failure tests (the failure was injected, not skipped)', () => {
  assert.ok(ollamaHits > 0);
});
