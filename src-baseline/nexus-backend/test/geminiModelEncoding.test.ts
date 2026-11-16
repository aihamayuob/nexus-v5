// D-10 (owner mandate 2026-11-16): the model name is placed in the URL PATH for Gemini; a client-supplied name must not be able to
// alter the path/query/host (the API key is in a header, so impact was bounded, but the request URL must be exactly the intended resource).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiAdapter } from '../src/providers/geminiAdapter.js';

function capture() {
  const urls: string[] = [];
  const fetchImpl = (async (u: any) => { urls.push(String(u)); return new Response('{}', { status: 400 }); }) as any;
  const cfg = { id: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'k', timeoutMs: 1000 } as any;
  return { urls, adapter: createGeminiAdapter(cfg, fetchImpl) };
}
const base = { messages: [{ role: 'user', content: 'hi' }], maxTokens: 8 } as any;

test('D-10: normal model name is unchanged in the URL (chat + stream)', async () => {
  const { urls, adapter } = capture();
  await adapter.chat({ ...base, model: 'gemini-2.5-pro' }).catch(() => {});
  await adapter.chatStream({ ...base, model: 'gemini-2.5-pro' }, {} as any).catch(() => {});
  assert.equal(urls[0], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
  assert.equal(urls[1], 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse');
});

test('D-10: a hostile model name cannot inject path segments, query or fragment', async () => {
  const hostile = 'x:generateContent?key=evil#/../../v1beta/tunedModels/y';
  const { urls, adapter } = capture();
  await adapter.chat({ ...base, model: hostile }).catch(() => {});
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]!);
  assert.equal(u.host, 'generativelanguage.googleapis.com');
  assert.equal(u.search, '', 'no query may be injected');
  assert.equal(u.hash, '', 'no fragment may be injected');
  assert.match(u.pathname, /^\/v1beta\/models\/[^/]+:generateContent$/, `model must stay ONE path segment, got ${u.pathname}`);
});

test('D-10: hostile model name is also contained for streaming and embeddings', async () => {
  const hostile = 'x?key=evil#frag/../y';
  const { urls, adapter } = capture();
  await adapter.chatStream({ ...base, model: hostile }, {} as any).catch(() => {});
  await adapter.embed(['a'], hostile).catch(() => {});
  assert.equal(urls.length, 2);
  for (const raw of urls) { const u = new URL(raw); assert.equal(u.hash, ''); assert.ok(!u.search.includes('key=evil'), raw); assert.match(u.pathname, /^\/v1beta\/models\/[^/]+:\w+$/, u.pathname); }
});
