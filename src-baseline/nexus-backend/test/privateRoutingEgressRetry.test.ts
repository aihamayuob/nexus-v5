import './helpers/setPrivacyRetryTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { runChatCompletion } from '../src/orchestrator/chatService.js';
import { TaskObservability } from '../src/observability/recorder.js';
import { NexusHttpError } from '../src/core/errors.js';
import { startFakeAnthropicServer } from './helpers/fakeAnthropicServer.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';

/** GAP-1: the retry path. With NEXUS_MAX_RETRIES=2 the failing LOCAL provider is retried (3 attempts); every one of them must stay local and no cloud request may follow. */

const ctx: GatewayContext = { authenticated: true, clientKey: 'privacy-retry-test', projectId: null, userId: null };
let nexus: Server;
let brokenLocal: Server;
let cloud: Awaited<ReturnType<typeof startFakeAnthropicServer>>;
let localHits = 0;

function listen(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    })
  );
}

before(async () => {
  brokenLocal = createServer((_req, res) => {
    localHits++;
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'local model server down' }));
  });
  process.env.NEXUS_OLLAMA_BASE_URL = await listen(brokenLocal);
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';
  cloud = await startFakeAnthropicServer({ respond: () => ({ text: 'cloud answered', stopReason: 'end_turn' }) });
  process.env.NEXUS_ANTHROPIC_BASE_URL = cloud.url;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';
  nexus = createNexusServer();
});

after(async () => {
  await Promise.all([brokenLocal, nexus].map((s) => new Promise((r) => s.close(r))));
  await new Promise((r) => cloud.server.close(r));
});

for (const mode of ['LOCAL_ONLY', 'PRIVATE'] as const) {
  test(`[${mode}] retries stay local: local attempted 3 times, then local_provider_unavailable, cloud receives nothing`, async () => {
    const hitsBefore = localHits;
    const cloudBefore = cloud.requestLog.length;
    await assert.rejects(
      () =>
        runChatCompletion(
          { mode, maxTokens: 50, messages: [{ role: 'user', content: `CONFIDENTIAL-${mode}-retry-5d3a` }], route: 'chat', taskId: `egress-retry-${mode}` },
          ctx,
          new TaskObservability(`egress-retry-${mode}`, 'chat')
        ),
      (e: unknown) => e instanceof NexusHttpError && e.code === 'local_provider_unavailable'
    );
    assert.equal(localHits - hitsBefore, 3, 'expected the initial attempt plus 2 retries, all against the local provider');
    assert.equal(cloud.requestLog.length - cloudBefore, 0);
  });
}
