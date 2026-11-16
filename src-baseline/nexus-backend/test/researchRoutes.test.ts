import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeGemini: Server;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
    });
  });
}

before(async () => {
  fakeGemini = createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'إجابة عبر HTTP.' }] },
            finishReason: 'STOP',
            groundingMetadata: { webSearchQueries: ['test query'], groundingChunks: [{ web: { uri: 'https://example.com/x' } }] },
          },
        ],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5 },
      })
    );
  });
  process.env.NEXUS_GEMINI_BASE_URL = await listen(fakeGemini);
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';
  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await Promise.all([new Promise((r) => nexusServer.close(r)), new Promise((r) => fakeGemini.close(r))]);
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

test('POST /v2/research/web returns a real grounded answer over HTTP', async () => {
  const res = await fetch(`${nexusUrl}/v2/research/web`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'سؤال اختبار', persistToMemory: false }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ran: boolean; answer: string; sources: unknown[] };
  assert.equal(body.ran, true);
  assert.match(body.answer, /HTTP/);
  assert.equal(body.sources.length, 1);
});

test('POST /v2/research/web with a missing question is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/research/web`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});
