import './helpers/setFallbackTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let failingAnthropic: Server;
let workingOpenAI: Server;

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
  // Primary provider: always fails with a retryable 503.
  failingAnthropic = createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream overloaded' } }));
  });
  const anthropicUrl = await listen(failingAnthropic);
  process.env.NEXUS_ANTHROPIC_BASE_URL = anthropicUrl;
  process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key';

  // Fallback provider: a working OpenAI-Chat-Completions-shaped server.
  workingOpenAI = createServer(async (req, res) => {
    for await (const _ of req) void _; // drain
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { content: 'answered by the FALLBACK provider' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 4 },
      })
    );
  });
  const openaiUrl = await listen(workingOpenAI);
  process.env.NEXUS_OPENAI_BASE_URL = openaiUrl;
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key';

  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await Promise.all([
    new Promise((r) => nexusServer.close(r)),
    new Promise((r) => failingAnthropic.close(r)),
    new Promise((r) => workingOpenAI.close(r)),
  ]);
});

test('when the primary provider fails, the request automatically falls back to a configured secondary provider and still succeeds', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'anthropic', // the one that's guaranteed to fail in this test
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
    }),
  });
  assert.equal(res.status, 200, 'the overall request must still succeed via fallback, not surface the primary provider\'s failure');
  const body = (await res.json()) as any;
  const textBlock = body.content.find((b: { type: string }) => b.type === 'text');
  assert.equal(textBlock.text, 'answered by the FALLBACK provider');
});
