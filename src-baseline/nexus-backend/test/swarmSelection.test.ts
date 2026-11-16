import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRegistry } from '../src/agents/agentRegistry.js';

test('selectTopAgentsForTask surfaces genuinely relevant agents via real keyword overlap, not arbitrary ones', () => {
  const picked = AgentRegistry.selectTopAgentsForTask('نريد تحليل مالي وقانوني لفرصة استثمار عقاري جديدة', 4);
  const ids = picked.map((d) => d.id);
  assert.ok(ids.includes('financial'), 'financial keyword ("مالي") should surface the financial agent');
  assert.ok(ids.includes('legal'), 'legal keyword ("قانوني") should surface the legal agent');
});

test('selectTopAgentsForTask never returns "general" or "supervisor", even if their own keywords are present in the topic', () => {
  const picked = AgentRegistry.selectTopAgentsForTask('نحتاج إشراف وتنسيق عام على الفريق', 4);
  const ids = picked.map((d) => d.id);
  assert.ok(!ids.includes('general'));
  assert.ok(!ids.includes('supervisor'));
});

test('selectTopAgentsForTask returns FEWER than n rather than padding with unrelated agents when the topic is narrow', () => {
  const picked = AgentRegistry.selectTopAgentsForTask('سؤال بسيط جداً عن الطقس اليوم', 4);
  // "الطقس" doesn't genuinely overlap with any built-in agent's real skill keywords
  assert.ok(picked.length < 4, `expected a narrow/unrelated topic to yield fewer than 4 real matches, got ${picked.length}`);
});

test('selectTopAgentsForTask on a completely empty topic returns zero agents, not a crash or a fabricated default panel', () => {
  const picked = AgentRegistry.selectTopAgentsForTask('', 4);
  assert.equal(picked.length, 0);
});

test('selectTopAgentsForTask never returns duplicate agent ids', () => {
  const picked = AgentRegistry.selectTopAgentsForTask('تسويق وتقني وبرمجة وهندسة برمجيات', 4);
  const ids = picked.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('selectAgentForTask (the pre-existing single-best selector) is completely unchanged — regression', () => {
  const best = AgentRegistry.selectAgentForTask('استشارة قانونية بخصوص عقد');
  assert.equal(best.id, 'legal');
});
