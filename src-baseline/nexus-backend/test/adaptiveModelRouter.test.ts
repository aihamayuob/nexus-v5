import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { rankFallbacks, scoreProvider } from '../src/providers/adaptiveModelRouter.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

function seedCalls(provider: string, route: string, n: number, successRate: number, latencyMs = 500) {
  const repo = getRepos().providerCallLog;
  for (let i = 0; i < n; i++) {
    repo.record({
      taskId: null,
      provider,
      model: 'test-model',
      route,
      success: i < n * successRate,
      latencyMs,
      costUsd: 0.001,
      errorMessage: i < n * successRate ? null : 'simulated failure',
    });
  }
}

test('AdaptiveModelRouter: with no history at all, returns candidates unchanged (cold start)', () => {
  freshDb();
  const result = rankFallbacks(['openai', 'gemini', 'deepseek'], 'chat');
  assert.deepEqual(result, ['openai', 'gemini', 'deepseek']);
});

test('AdaptiveModelRouter: with enough evidence, ranks the more reliable provider first', () => {
  freshDb();
  seedCalls('openai', 'chat', 20, 0.5); // 50% success
  seedCalls('gemini', 'chat', 20, 0.95); // 95% success
  const result = rankFallbacks(['openai', 'gemini'], 'chat');
  assert.equal(result[0], 'gemini', 'the more reliable provider should be ranked first');
});

test('AdaptiveModelRouter: a provider with only a handful of calls (low confidence) never leapfrogs a well-evidenced one, even with a perfect tiny sample', () => {
  freshDb();
  seedCalls('deepseek', 'chat', 30, 0.85); // well-evidenced, decent reliability
  seedCalls('gemini', 'chat', 2, 1.0); // only 2 calls, both succeeded — tiny sample
  const result = rankFallbacks(['gemini', 'deepseek'], 'chat');
  assert.equal(result[0], 'deepseek', 'well-evidenced provider should rank ahead of a barely-tried one');
});

test('AdaptiveModelRouter: scoreProvider never reports a fabricated "accuracy" field, and returns nulls when there is no data', () => {
  freshDb();
  const score = scoreProvider('openai', { route: 'chat' });
  assert.equal(score.sampleSize, 0);
  assert.equal(score.successRate, null);
  assert.equal(score.avgLatencyMs, null);
  assert.equal('accuracy' in score, false);
});

test('AdaptiveModelRouter: routing evidence is scoped per-route — a provider that fails in one task type is not penalized in another', () => {
  freshDb();
  seedCalls('openai', 'runtime_plan', 20, 0.2); // terrible for planning tasks
  seedCalls('openai', 'chat', 20, 0.95); // great for plain chat
  const planScore = scoreProvider('openai', { route: 'runtime_plan' });
  const chatScore = scoreProvider('openai', { route: 'chat' });
  assert.ok(chatScore.successRate! > planScore.successRate!, 'per-route scoping must keep these two evidence pools separate');
});

test('AdaptiveModelRouter: rankFallbacks never adds or removes candidates, only reorders', () => {
  freshDb();
  seedCalls('openai', 'chat', 10, 1.0);
  const result = rankFallbacks(['openai', 'gemini', 'deepseek'], 'chat');
  assert.deepEqual([...result].sort(), ['deepseek', 'gemini', 'openai']);
});
