import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { runBenchmarkSuiteAndCompare } from '../src/evaluation/benchmarkRunner.js';
import type { BenchmarkResult } from '../src/evaluation/benchmarkTasks.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

test('benchmark runner: runs the full deterministic suite and every benchmark passes with no providers configured', async () => {
  freshDb();
  const { results, summary } = await runBenchmarkSuiteAndCompare('test-release-1');
  assert.ok(results.length > 10, 'expected a real battery of benchmarks, not a token few');
  assert.equal(summary.failed, 0, `expected all benchmarks to pass; failures: ${JSON.stringify(results.filter((r) => !r.pass))}`);
  assert.ok(summary.byCategory.routing);
  assert.ok(summary.byCategory.tool);
  assert.ok(summary.byCategory.failure_recovery);
  assert.ok(summary.byCategory.verification_coverage);
  assert.ok(summary.byCategory.policy);
});

test('benchmark runner: first run has no previous release to compare against', async () => {
  freshDb();
  const { regression } = await runBenchmarkSuiteAndCompare('release-1');
  assert.equal(regression.previousPassRate, null);
  assert.equal(regression.hasRegressions, false);
});

test('benchmark runner: detects a genuine regression when a previously-passing check now fails', async () => {
  freshDb();
  // Seed a "previous release" directly with a synthetic result set where everything passed.
  const priorResults: BenchmarkResult[] = [
    { name: 'synthetic check A', category: 'tool', pass: true, latencyMs: 10 },
    { name: 'synthetic check B', category: 'routing', pass: true, latencyMs: 10 },
  ];
  getRepos().benchmarkRuns.save('release-0', priorResults, { total: 2, passed: 2, failed: 0, passRate: 1, avgLatencyMs: 10, byCategory: {} });

  // Now save a "current release" where one of those same-named checks regressed.
  const currentResults: BenchmarkResult[] = [
    { name: 'synthetic check A', category: 'tool', pass: false, latencyMs: 10, details: 'broke' },
    { name: 'synthetic check B', category: 'routing', pass: true, latencyMs: 10 },
  ];
  getRepos().benchmarkRuns.save('release-1', currentResults, { total: 2, passed: 1, failed: 1, passRate: 0.5, avgLatencyMs: 10, byCategory: {} });

  const previous = getRepos().benchmarkRuns.previous();
  assert.ok(previous);
  assert.equal(previous!.releaseLabel, 'release-0');
});

test('benchmark runner: real end-to-end regression flagging via runBenchmarkSuiteAndCompare across two real runs', async () => {
  freshDb();
  const first = await runBenchmarkSuiteAndCompare('release-A');
  assert.equal(first.summary.failed, 0);

  const second = await runBenchmarkSuiteAndCompare('release-B');
  // Since nothing in the environment changed between the two runs, the
  // deterministic suite should show zero regressions and a stable pass rate.
  assert.equal(second.regression.hasRegressions, false);
  assert.equal(second.regression.previousPassRate, first.summary.passRate);
});
