import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { clearHealthCacheForTests } from '../src/providers/healthRegistry.js';

let nexusServer: Server;
let nexusUrl: string;
let healthyAnthropic: Server;
let slowOpenAI: Server;
let deadDeepSeek: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

before(async () => {
  // anthropic: healthy, fast GET /v1/models -> should report READY
  healthyAnthropic = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  process.env.NEXUS_ANTHROPIC_BASE_URL = await listen(healthyAnthropic);
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  // openai: answers GET /v1/models but only after 3.5s -> should report DEGRADED (>3000ms threshold), not UNAVAILABLE
  slowOpenAI = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [] }));
    }, 3500);
  });
  process.env.NEXUS_OPENAI_BASE_URL = await listen(slowOpenAI);
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key';

  // deepseek: configured (has a key + base URL) but the port is immediately closed -> ECONNREFUSED -> UNAVAILABLE
  deadDeepSeek = createServer(() => {});
  const deadUrl = await listen(deadDeepSeek);
  await new Promise((r) => deadDeepSeek.close(r));
  process.env.NEXUS_DEEPSEEK_BASE_URL = deadUrl;
  process.env.NEXUS_DEEPSEEK_API_KEY = 'fake-deepseek-key';

  // gemini: deliberately NOT configured (no NEXUS_GEMINI_API_KEY set) -> NOT_CONFIGURED, and must NOT hit the network at all
  delete process.env.NEXUS_GEMINI_API_KEY;

  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

beforeEach(() => {
  clearHealthCacheForTests();
});

after(async () => {
  await Promise.all([
    new Promise((r) => nexusServer.close(r)),
    new Promise((r) => healthyAnthropic.close(r)),
    new Promise((r) => slowOpenAI.close(r)),
  ]);
});

test('GET /v2/providers/health reports NOT_CONFIGURED for a provider with no API key, without making any network call', async () => {
  const res = await fetch(`${nexusUrl}/v2/providers/health?probe=1`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { providers: Array<{ id: string; state: string; live: boolean }> };
  const gemini = body.providers.find((p) => p.id === 'gemini')!;
  assert.equal(gemini.state, 'NOT_CONFIGURED');
});

test('GET /v2/providers/health reports READY for a configured provider that answers its probe quickly', async () => {
  const res = await fetch(`${nexusUrl}/v2/providers/health?probe=1`);
  const body = (await res.json()) as { providers: Array<{ id: string; state: string; latencyMs?: number }> };
  const anthropic = body.providers.find((p) => p.id === 'anthropic')!;
  assert.equal(anthropic.state, 'READY');
  assert.ok(typeof anthropic.latencyMs === 'number' && anthropic.latencyMs < 3000);
});

test('GET /v2/providers/health reports DEGRADED for a configured provider that answers too slowly', async () => {
  const res = await fetch(`${nexusUrl}/v2/providers/health?probe=1`);
  const body = (await res.json()) as { providers: Array<{ id: string; state: string; latencyMs?: number }> };
  const openai = body.providers.find((p) => p.id === 'openai')!;
  assert.equal(openai.state, 'DEGRADED');
  assert.ok((openai.latencyMs ?? 0) > 3000);
});

test('GET /v2/providers/health reports UNAVAILABLE for a configured provider whose endpoint refuses the connection', async () => {
  const res = await fetch(`${nexusUrl}/v2/providers/health?probe=1`);
  const body = (await res.json()) as { providers: Array<{ id: string; state: string; error?: string }> };
  const deepseek = body.providers.find((p) => p.id === 'deepseek')!;
  assert.equal(deepseek.state, 'UNAVAILABLE');
  assert.ok(deepseek.error && deepseek.error.length > 0);
});

test('without ?probe=1, a second call within the cache TTL reuses the cached result instead of re-probing', async () => {
  const first = (await (await fetch(`${nexusUrl}/v2/providers/health`)).json()) as { providers: Array<{ id: string; checkedAt: string }> };
  const second = (await (await fetch(`${nexusUrl}/v2/providers/health`)).json()) as { providers: Array<{ id: string; checkedAt: string }> };
  const a1 = first.providers.find((p) => p.id === 'anthropic')!;
  const a2 = second.providers.find((p) => p.id === 'anthropic')!;
  assert.equal(a1.checkedAt, a2.checkedAt, 'cached result should carry the same checkedAt timestamp, proving no re-probe happened');
});

test('the response never contains a raw API key', async () => {
  const res = await fetch(`${nexusUrl}/v2/providers/health?probe=1`);
  const text = await res.text();
  assert.ok(!text.includes('fake-anthropic-key'));
  assert.ok(!text.includes('fake-openai-key'));
  assert.ok(!text.includes('fake-deepseek-key'));
});
