import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { clearHealthCacheForTests } from '../src/providers/healthRegistry.js';
import { selectProviderForMode } from '../src/providers/routingModes.js';

let nexusServer: Server;
let nexusUrl: string;
let fastAnthropic: Server;
let slowOpenAI: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function jsonModelsHandler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [] }));
}

before(async () => {
  // anthropic: answers /v1/models almost instantly -> low latency
  fastAnthropic = createServer(jsonModelsHandler);
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(fastAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  // openai: answers /v1/models but only after 800ms -> still READY (<3000ms threshold) but clearly slower than anthropic
  slowOpenAI = createServer((req, res) => setTimeout(() => jsonModelsHandler(req, res), 800));
  process.env.NEXUS_OPENAI_BASE_URL = await listen(slowOpenAI);
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key';

  // deepseek + gemini: configured (has a key) but nothing listening -> UNAVAILABLE, must never win FASTEST/BEST
  process.env.NEXUS_DEEPSEEK_API_KEY = 'fake-deepseek-key';
  process.env.NEXUS_DEEPSEEK_BASE_URL = 'http://127.0.0.1:1'; // reserved/unroutable port -> fast, deterministic connection failure
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';
  process.env.NEXUS_GEMINI_BASE_URL = 'http://127.0.0.1:1';

  // local providers deliberately left unconfigured (no model set) for most tests — LOCAL_ONLY/PRIVATE tests override this per-test

  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

beforeEach(() => {
  clearHealthCacheForTests();
  delete process.env.NEXUS_MODEL_OLLAMA;
  delete process.env.NEXUS_MODEL_LMSTUDIO;
});

after(async () => {
  await Promise.all([
    new Promise((r) => nexusServer.close(r)),
    new Promise((r) => fastAnthropic.close(r)),
    new Promise((r) => slowOpenAI.close(r)),
  ]);
});

test('USER_SELECTED delegates straight to routeModel and requires a provider', async () => {
  const routed = await selectProviderForMode({ mode: 'USER_SELECTED', userSelectedProvider: 'anthropic' });
  assert.equal(routed.provider, 'anthropic');
  await assert.rejects(() => selectProviderForMode({ mode: 'USER_SELECTED' }), /USER_SELECTED/);
});

test('CHEAPEST picks the lowest-cost configured cloud provider (gemini, per the shared rate table)', async () => {
  const routed = await selectProviderForMode({ mode: 'CHEAPEST' });
  assert.equal(routed.provider, 'gemini');
});

test('FASTEST picks the provider with the lowest live-probed latency, excluding unreachable ones', async () => {
  const routed = await selectProviderForMode({ mode: 'FASTEST' });
  assert.equal(routed.provider, 'anthropic', 'anthropic answers /v1/models near-instantly; openai is slower; deepseek/gemini are unreachable');
});

test('BEST falls back to registry declaration order with zero evidence (cold start), restricted to live-READY providers', async () => {
  const routed = await selectProviderForMode({ mode: 'BEST' });
  // cold start (no observability history yet in this in-memory DB) -> rankFallbacks returns input order unchanged;
  // input order is live-READY candidates only, so deepseek/gemini (unreachable) must be excluded even though
  // they're declared earlier in the registry than anthropic/openai.
  assert.ok(['anthropic', 'openai'].includes(routed.provider), `expected anthropic or openai (both READY), got ${routed.provider}`);
});

test('LOCAL_ONLY refuses to pick a cloud provider even when cloud providers are configured and local ones are not', async () => {
  await assert.rejects(() => selectProviderForMode({ mode: 'LOCAL_ONLY' }), /LOCAL_ONLY/);
});

test('LOCAL_ONLY picks a local provider once one is actually configured with a model name', async () => {
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';
  const routed = await selectProviderForMode({ mode: 'LOCAL_ONLY' });
  assert.equal(routed.provider, 'ollama');
});

test('PRIVATE behaves identically to LOCAL_ONLY today (documented simplification, not silently different)', async () => {
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';
  const routed = await selectProviderForMode({ mode: 'PRIVATE' });
  assert.equal(routed.provider, 'ollama');
});

test('needsWebSearch intent restricts every mode to gemini-capable providers only, same as routeModel', async () => {
  // gemini is configured but unreachable in this suite -> BEST with needsWebSearch should still only ever
  // consider gemini (the only webSearch-capable provider) even though anthropic/openai are faster/healthier.
  const routed = await selectProviderForMode({ mode: 'BEST', intent: { needsWebSearch: true } });
  assert.equal(routed.provider, 'gemini');
});

test('POST /v2/route resolves a mode exactly like selectProviderForMode, over HTTP', async () => {
  const res = await fetch(`${nexusUrl}/v2/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'CHEAPEST' }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { mode: string; provider: string; model: string };
  assert.equal(body.mode, 'CHEAPEST');
  assert.equal(body.provider, 'gemini');
});

test('POST /v2/route without a mode is a clear validation error, not a crash', async () => {
  const res = await fetch(`${nexusUrl}/v2/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
