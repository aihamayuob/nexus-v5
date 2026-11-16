import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { setAdapterForTests, clearAdapterCacheForTests } from '../src/providers/index.js';
import { embedTexts } from '../src/memory/embeddingsService.js';
import type { GatewayContext } from '../src/capability/permissionModel.js';
import type { ProviderAdapter } from '../src/providers/contract.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

const ctx: GatewayContext = { authenticated: true, clientKey: 'test', projectId: null, userId: null };

function fakeOllamaAdapter(callLog: string[][]): ProviderAdapter {
  return {
    id: 'ollama',
    supportsEmbeddings: true,
    async chat() {
      throw new Error('not used in this test');
    },
    async chatStream() {
      throw new Error('not used in this test');
    },
    async embed(texts: string[], model?: string) {
      callLog.push([...texts]);
      return { embeddings: texts.map((t) => [t.length, t.length * 2, t.length * 3]), model: model || 'test-model' };
    },
  };
}

test('embeddingsService: deduplicates identical text within one call', async () => {
  freshDb();
  clearAdapterCacheForTests();
  const callLog: string[][] = [];
  setAdapterForTests('ollama', fakeOllamaAdapter(callLog));

  const result = await embedTexts(['hello', 'world', 'hello'], 'ollama', ctx);

  assert.equal(callLog.length, 1, 'provider.embed should be called exactly once');
  assert.deepEqual(callLog[0], ['hello', 'world'], 'only the two UNIQUE texts should be sent, not the duplicate');
  assert.equal(result.embeddings.length, 3);
  assert.deepEqual(result.embeddings[0], result.embeddings[2], 'both "hello" entries must get the identical vector');
  assert.equal(result.cacheMisses, 2);
  assert.equal(result.cacheHits, 0);
});

test('embeddingsService: reuses the cache on a second call for the same text (no re-embedding)', async () => {
  freshDb();
  clearAdapterCacheForTests();
  const callLog: string[][] = [];
  setAdapterForTests('ollama', fakeOllamaAdapter(callLog));

  const first = await embedTexts(['persist me'], 'ollama', ctx);
  const second = await embedTexts(['persist me'], 'ollama', ctx);

  assert.equal(callLog.length, 1, 'the second call must NOT hit the provider again — it should be a pure cache hit');
  assert.deepEqual(second.embeddings[0], first.embeddings[0]);
  assert.equal(second.cacheHits, 1);
  assert.equal(second.cacheMisses, 0);
});

test('embeddingsService: batches multiple distinct cache-miss texts into a single provider call', async () => {
  freshDb();
  clearAdapterCacheForTests();
  const callLog: string[][] = [];
  setAdapterForTests('ollama', fakeOllamaAdapter(callLog));

  await embedTexts(['a', 'b', 'c', 'd', 'e'], 'ollama', ctx);

  assert.equal(callLog.length, 1, 'five distinct new texts should still be ONE batched provider call, not five');
  assert.equal(callLog[0]?.length, 5);
});

test('embeddingsService: mixes cache hits and misses correctly in one call', async () => {
  freshDb();
  clearAdapterCacheForTests();
  const callLog: string[][] = [];
  setAdapterForTests('ollama', fakeOllamaAdapter(callLog));

  await embedTexts(['warm'], 'ollama', ctx); // primes the cache for "warm"
  const result = await embedTexts(['warm', 'cold'], 'ollama', ctx);

  assert.equal(callLog.length, 2); // 1 priming call + 1 real call
  assert.deepEqual(callLog[1], ['cold'], 'the second call should only send the cache-miss text, not the already-cached one');
  assert.equal(result.cacheHits, 1);
  assert.equal(result.cacheMisses, 1);
});
