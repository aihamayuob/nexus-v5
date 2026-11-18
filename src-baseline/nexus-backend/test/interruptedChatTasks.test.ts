// A1 finding (2026-11-18, e2e P8): a `chat`-kind task (the fast path behind /v2/tasks, /api/chat and A2A SendMessage) interrupted by a process
// crash stayed 'running' FOREVER after restart — plans/missions/councils/VEL receipts each have boot recovery, chat tasks had none.
// A peer (or /v2/tasks client) polling such a task would wait indefinitely. This pins the boot sweep and its scope.
import './helpers/setTestEnv.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { failInterruptedChatTasks } from '../src/orchestrator/taskManager.js';

beforeEach(() => resetReposSingletonForTests(buildRepos(openTestDb())));

const mk = (id: string, kind: 'chat' | 'runtime_plan', status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled') => {
  getRepos().tasks.create({ id, kind, status, idempotencyKey: null, provider: 'anthropic', model: null, goalOrPromptLen: 5, projectId: null, userId: null, errorMessage: null });
};

test('a chat task left running by a crash becomes a terminal failed task with an explicit reason', () => {
  mk('c-run', 'chat', 'running');
  const n = failInterruptedChatTasks();
  assert.equal(n, 1);
  const t = getRepos().tasks.get('c-run')!;
  assert.equal(t.status, 'failed');
  assert.match(t.errorMessage ?? '', /restart|interrupted|إعادة التشغيل|انقطع/i);
  assert.ok(t.finishedAt, 'finishedAt must be set so retention/observability treat it as finished');
});

test('a chat task left pending (claimed but never dispatched) is also failed', () => {
  mk('c-pend', 'chat', 'pending');
  assert.equal(failInterruptedChatTasks(), 1);
  assert.equal(getRepos().tasks.get('c-pend')!.status, 'failed');
});

test('terminal chat tasks are untouched (done / failed / cancelled keep status and message)', () => {
  mk('c-done', 'chat', 'done'); mk('c-cancel', 'chat', 'cancelled'); mk('c-fail', 'chat', 'failed');
  getRepos().tasks.updateStatus('c-fail', 'failed', 'original reason');
  assert.equal(failInterruptedChatTasks(), 0);
  assert.equal(getRepos().tasks.get('c-done')!.status, 'done');
  assert.equal(getRepos().tasks.get('c-cancel')!.status, 'cancelled');
  assert.equal(getRepos().tasks.get('c-fail')!.errorMessage, 'original reason');
});

test('runtime_plan tasks are NOT touched — they have their own durable resume (resumeInterruptedPlans)', () => {
  mk('p-run', 'runtime_plan', 'running'); mk('p-pend', 'runtime_plan', 'pending');
  assert.equal(failInterruptedChatTasks(), 0);
  assert.equal(getRepos().tasks.get('p-run')!.status, 'running');
  assert.equal(getRepos().tasks.get('p-pend')!.status, 'pending');
});

test('the sweep is idempotent (a second run changes nothing)', () => {
  mk('c-run', 'chat', 'running');
  assert.equal(failInterruptedChatTasks(), 1);
  assert.equal(failInterruptedChatTasks(), 0);
});
