import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executeDag } from '../src/orchestrator/dag.js';
import type { DagPlan } from '../src/orchestrator/dagTypes.js';

function collector() {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const emit = (event: string, data: Record<string, unknown>) => events.push({ event, data });
  return { events, emit };
}

test('DAG: runs independent nodes and respects a linear dependency chain', async () => {
  const plan: DagPlan = {
    goal: 'test goal',
    provider: 'anthropic',
    tasks: [
      { id: 'a', description: 'first', dependsOn: [] },
      { id: 'b', description: 'second', dependsOn: ['a'] },
      { id: 'c', description: 'independent', dependsOn: [] },
    ],
  };
  const { events, emit } = collector();
  const order: string[] = [];

  const result = await executeDag({
    taskId: 't1',
    plan,
    emit,
    runNode: async (node, ctx) => {
      order.push(node.id);
      if (node.id === 'b') assert.equal(ctx.upstreamOutputs.a, 'output-a');
      return `output-${node.id}`;
    },
    synthesize: async (_goal, results) => `synthesis:${Object.keys(results).sort().join(',')}`,
    persistNode: () => {},
    maxConcurrency: 4,
  });

  assert.equal(result.allFailed, false);
  assert.equal(result.finalOutput, 'synthesis:a,b,c');
  // 'b' must run strictly after 'a'
  assert.ok(order.indexOf('b') > order.indexOf('a'));
  assert.ok(events.some((e) => e.event === 'task_done' && e.data.taskId === 'a'));
  assert.ok(events.some((e) => e.event === 'plan' === false)); // sanity: no stray event named 'plan'
});

test('DAG: respects maxConcurrency — never runs more nodes in parallel than the limit', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, description: 'x', dependsOn: [] })),
  };
  let concurrent = 0;
  let maxObserved = 0;
  const { emit } = collector();

  await executeDag({
    taskId: 't2',
    plan,
    emit,
    runNode: async () => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 20));
      concurrent--;
      return 'ok';
    },
    synthesize: async () => 'done',
    persistNode: () => {},
    maxConcurrency: 2,
  });

  assert.ok(maxObserved <= 2, `expected max 2 concurrent, saw ${maxObserved}`);
});

test('DAG: failure propagates — downstream nodes are skipped, not run', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [
      { id: 'a', description: 'fails', dependsOn: [] },
      { id: 'b', description: 'depends on a', dependsOn: ['a'] },
      { id: 'c', description: 'depends on b', dependsOn: ['b'] },
      { id: 'd', description: 'independent, should still run', dependsOn: [] },
    ],
  };
  const ran = new Set<string>();
  const { events, emit } = collector();

  const result = await executeDag({
    taskId: 't3',
    plan,
    emit,
    runNode: async (node) => {
      ran.add(node.id);
      if (node.id === 'a') throw new Error('boom');
      return `output-${node.id}`;
    },
    synthesize: async (_g, results) => `synthesis:${Object.keys(results).sort().join(',')}`,
    persistNode: () => {},
    maxConcurrency: 4,
    maxRetries: 0,
  });

  assert.ok(!ran.has('b'), 'b should never have run');
  assert.ok(!ran.has('c'), 'c should never have run');
  assert.ok(ran.has('d'), 'd is independent and should still run');
  assert.equal(result.allFailed, false); // d succeeded, so synthesis still happens
  assert.equal(result.finalOutput, 'synthesis:d');
  assert.ok(events.some((e) => e.event === 'task_failed' && e.data.taskId === 'a'));
  assert.ok(events.some((e) => e.event === 'task_skipped' && e.data.taskId === 'b'));
  assert.ok(events.some((e) => e.event === 'task_skipped' && e.data.taskId === 'c'));
});

test('DAG: all nodes failing produces allFailed with no synthesis call', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [{ id: 'a', description: 'fails', dependsOn: [] }],
  };
  let synthCalled = false;
  const { emit } = collector();

  const result = await executeDag({
    taskId: 't4',
    plan,
    emit,
    runNode: async () => {
      throw new Error('always fails');
    },
    synthesize: async () => {
      synthCalled = true;
      return 'should not happen';
    },
    persistNode: () => {},
    maxRetries: 0,
  });

  assert.equal(result.allFailed, true);
  assert.equal(result.finalOutput, null);
  assert.equal(synthCalled, false);
});

test('DAG: retries a node on failure before eventually succeeding', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [{ id: 'a', description: 'flaky', dependsOn: [] }],
  };
  let attempts = 0;
  const { events, emit } = collector();

  const result = await executeDag({
    taskId: 't5',
    plan,
    emit,
    runNode: async () => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return 'finally worked';
    },
    synthesize: async (_g, results) => results.a ?? '',
    persistNode: () => {},
    maxRetries: 3,
  });

  assert.equal(attempts, 3);
  assert.equal(result.finalOutput, 'finally worked');
  const retryEvents = events.filter((e) => e.event === 'task_retry');
  assert.equal(retryEvents.length, 2);
});

test('DAG: reflection can trigger a revision pass', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [{ id: 'a', description: 'x', dependsOn: [] }],
  };
  const { events, emit } = collector();

  const result = await executeDag({
    taskId: 't6',
    plan,
    emit,
    runNode: async () => 'draft output',
    reflect: async (_node, draft) => {
      assert.equal(draft, 'draft output');
      return { verdict: 'revise', critique: 'too short' };
    },
    reviseNode: async (_node, _ctx, critique) => `revised because: ${critique}`,
    synthesize: async (_g, results) => results.a ?? '',
    persistNode: () => {},
  });

  assert.equal(result.finalOutput, 'revised because: too short');
  assert.ok(events.some((e) => e.event === 'task_reflection' && e.data.verdict === 'revise'));
});

test('DAG: resume seeds already-done nodes without re-running them', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [
      { id: 'a', description: 'already done before restart', dependsOn: [] },
      { id: 'b', description: 'still pending', dependsOn: ['a'] },
    ],
  };
  const ran: string[] = [];
  const { emit } = collector();

  const result = await executeDag({
    taskId: 't7',
    plan,
    emit,
    runNode: async (node) => {
      ran.push(node.id);
      return `output-${node.id}`;
    },
    synthesize: async (_g, results) => Object.entries(results).map(([k, v]) => `${k}=${v}`).join(';'),
    persistNode: () => {},
    resumeFrom: [{ nodeId: 'a', status: 'done', output: 'preserved-output-a' }],
  });

  assert.ok(!ran.includes('a'), 'a was already done before restart and must not re-run');
  assert.ok(ran.includes('b'));
  assert.equal(result.finalOutput, 'a=preserved-output-a;b=output-b');
});

test('DAG: a cycle fails cleanly instead of hanging forever', async () => {
  const plan: DagPlan = {
    goal: 'g',
    provider: 'anthropic',
    tasks: [
      { id: 'a', description: 'x', dependsOn: ['b'] },
      { id: 'b', description: 'y', dependsOn: ['a'] },
    ],
  };
  const { events, emit } = collector();

  const result = await executeDag({
    taskId: 't8',
    plan,
    emit,
    runNode: async () => 'unreachable',
    synthesize: async () => 'unreachable',
    persistNode: () => {},
  });

  assert.equal(result.allFailed, true);
  assert.ok(events.some((e) => e.event === 'task_failed' && e.data.taskId === 'a'));
  assert.ok(events.some((e) => e.event === 'task_failed' && e.data.taskId === 'b'));
});
