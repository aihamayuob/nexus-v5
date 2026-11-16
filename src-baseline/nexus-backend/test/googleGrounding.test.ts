import './helpers/setFallbackTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;
let fakeGemini: Server;
let lastRequestBody: any = null;

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
  fakeGemini = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    lastRequestBody = body;

    if (req.url?.includes(':streamGenerateContent')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const chunk1 = { candidates: [{ content: { parts: [{ text: 'وفقاً لنتائج البحث، ' }] } }] };
      const chunk2 = {
        candidates: [
          {
            content: { parts: [{ text: 'الجواب هو ٤٢.' }] },
            finishReason: 'STOP',
            groundingMetadata: {
              webSearchQueries: ['ما معنى الحياة'],
              groundingChunks: [{ web: { uri: 'https://example.com/answer', title: 'The Answer' } }],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      };
      res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
      res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
      res.end();
      return;
    }

    // non-streaming :generateContent
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: { parts: [{ text: 'الجواب هو ٤٢.' }] },
            finishReason: 'STOP',
            groundingMetadata: {
              webSearchQueries: ['ما معنى الحياة'],
              groundingChunks: [
                { web: { uri: 'https://example.com/answer', title: 'The Answer' } },
                { web: { uri: 'https://example.com/second-source' } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 6 },
      })
    );
  });
  process.env.NEXUS_GEMINI_BASE_URL = await listen(fakeGemini);
  process.env.NEXUS_GEMINI_API_KEY = 'fake-gemini-key';
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key'; // configured but has no webSearch capability — used for the rejection test

  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await Promise.all([new Promise((r) => nexusServer.close(r)), new Promise((r) => fakeGemini.close(r))]);
});

test('a non-streaming chat request with web_search:true against Gemini sends google_search as a native tool', async () => {
  lastRequestBody = null;
  await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', max_tokens: 100, web_search: true, messages: [{ role: 'user', content: 'ما معنى الحياة؟' }] }),
  });
  assert.ok(lastRequestBody, 'gemini fake server should have received a request');
  const tools = lastRequestBody.tools as unknown[];
  assert.ok(Array.isArray(tools) && tools.some((t: any) => t.google_search), 'request body must include a google_search tool entry');
});

test('a non-streaming chat request WITHOUT web_search does NOT send google_search', async () => {
  lastRequestBody = null;
  await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', max_tokens: 100, messages: [{ role: 'user', content: 'مرحباً' }] }),
  });
  assert.ok(!lastRequestBody.tools, 'no tools field at all should be sent when neither client tools nor webSearch were requested');
});

test('grounding metadata (citations) from Gemini is surfaced in the /api/chat response, non-streaming', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', max_tokens: 100, web_search: true, messages: [{ role: 'user', content: 'ما معنى الحياة؟' }] }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { grounding?: { webSearchQueries?: string[]; citations: Array<{ uri: string; title?: string }> } };
  assert.ok(body.grounding, 'response must include a grounding field when Gemini returned groundingMetadata');
  assert.equal(body.grounding!.citations.length, 2);
  assert.equal(body.grounding!.citations[0]!.uri, 'https://example.com/answer');
  assert.deepEqual(body.grounding!.webSearchQueries, ['ما معنى الحياة']);
});

test('grounding metadata is surfaced correctly over the SSE streaming path too', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'gemini', max_tokens: 100, web_search: true, stream: true, messages: [{ role: 'user', content: 'ما معنى الحياة؟' }] }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  const doneLine = text.split('\n\n').find((frame) => frame.includes('"done"') || frame.includes('event: done'));
  assert.ok(doneLine, `expected a 'done' SSE frame, got: ${text.slice(0, 500)}`);
  assert.ok(doneLine.includes('example.com/answer'), 'the done event payload should carry the grounding citations');
});

test('web_search:true against a provider without the capability (openai) is rejected, not silently ignored', async () => {
  const res = await fetch(`${nexusUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', max_tokens: 100, web_search: true, messages: [{ role: 'user', content: 'hello' }] }),
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as any;
  assert.equal(body.error.code, 'capability_denied');
});
