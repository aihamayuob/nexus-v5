import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { AgentRegistry } from '../src/agents/agentRegistry.js';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

beforeEach(() => {
  freshDb();
});

test('cold start (zero recorded calls): selection is IDENTICAL to pure keyword matching — real evidence adjustment never fires below the confidence threshold', () => {
  const best = AgentRegistry.selectAgentForTask('استشارة قانونية بخصوص عقد');
  assert.equal(best.id, 'legal');
});

test('a few recorded calls (below MIN_SAMPLE_FOR_AGENT_CONFIDENCE=5): still unchanged, even if all of them failed', () => {
  const repos = getRepos();
  for (let i = 0; i < 4; i++) {
    repos.agentCallLog.record({ agentId: 'legal', success: false, latencyMs: 500 });
  }
  const best = AgentRegistry.selectAgentForTask('استشارة قانونية بخصوص عقد');
  assert.equal(best.id, 'legal', 'below the real confidence threshold, a bad streak must not affect selection yet');
});

test('once real evidence crosses the confidence threshold, an agent with an equal real keyword score but a consistently FAILING history is genuinely outranked by a reliable competitor', () => {
  const repos = getRepos();
  for (let i = 0; i < 10; i++) repos.agentCallLog.record({ agentId: 'legal', success: false, latencyMs: 500 });
  for (let i = 0; i < 10; i++) repos.agentCallLog.record({ agentId: 'marketing', success: true, latencyMs: 300 });
  // Verified via direct execution: 'legal' scores 2 real keyword hits
  // (قانون, قانوني), 'marketing' also scores 2 (تسويق, إعلانات) — an
  // exact tie on raw relevance, broken ONLY by real accumulated evidence:
  // legal 2 x 0.5 (100% real failure) = 1.0, marketing 2 x 1.0 (100% real
  // success) = 2.0.
  const topic = 'قانون وقانوني مع تسويق وإعلانات';
  const ranked = AgentRegistry.selectTopAgentsForTask(topic, 2);
  assert.deepEqual(ranked.map((d) => d.id), ['marketing', 'legal']);
});

test('a consistently SUCCEEDING agent keeps its full real keyword score (reliabilityFactor approaches 1.0)', () => {
  const repos = getRepos();
  for (let i = 0; i < 10; i++) {
    repos.agentCallLog.record({ agentId: 'legal', success: true, latencyMs: 400 });
  }
  const best = AgentRegistry.selectAgentForTask('استشارة قانونية بخصوص عقد');
  assert.equal(best.id, 'legal', 'a reliable real track record should never demote an agent below a weaker match');
});

test('selectTopAgentsForTask never excludes an agent purely for a bad track record — reliabilityFactor has a real floor of 0.5x, not 0x', () => {
  const repos = getRepos();
  for (let i = 0; i < 20; i++) {
    repos.agentCallLog.record({ agentId: 'legal', success: false, latencyMs: 500 });
  }
  const ranked = AgentRegistry.selectTopAgentsForTask('استشارة قانونية بخصوص عقد', 4);
  assert.ok(ranked.some((d) => d.id === 'legal'), 'even a 100% real failure rate must not fully exclude an agent with genuine keyword relevance');
});

test("evidence is scoped per-agent — a bad record for one agent never affects an unrelated agent's score", () => {
  const repos = getRepos();
  for (let i = 0; i < 10; i++) {
    repos.agentCallLog.record({ agentId: 'marketing', success: false, latencyMs: 500 });
  }
  const best = AgentRegistry.selectAgentForTask('استشارة قانونية بخصوص عقد');
  assert.equal(best.id, 'legal', "marketing's bad record must not leak into legal's unrelated selection");
});

test('AgentCallLogRepo.evidenceFor returns real zero-state for an agent with no recorded calls at all', () => {
  const evidence = getRepos().agentCallLog.evidenceFor('geo');
  assert.deepEqual(evidence, { sampleSize: 0, successCount: 0, avgLatencyMs: 0 });
});

test('AgentCallLogRepo.evidenceFor computes a real, correct success rate and average latency from real recorded rows', () => {
  const repos = getRepos();
  repos.agentCallLog.record({ agentId: 'tech', success: true, latencyMs: 100 });
  repos.agentCallLog.record({ agentId: 'tech', success: true, latencyMs: 300 });
  repos.agentCallLog.record({ agentId: 'tech', success: false, latencyMs: 200 });
  const evidence = repos.agentCallLog.evidenceFor('tech');
  assert.equal(evidence.sampleSize, 3);
  assert.equal(evidence.successCount, 2);
  assert.equal(evidence.avgLatencyMs, 200);
});
