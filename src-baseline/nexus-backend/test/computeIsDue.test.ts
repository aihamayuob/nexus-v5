import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeIsDue } from '../src/scheduler/schedulerRunner.js';
import type { ScheduleRecord } from '../src/persistence/repositories/scheduleRepo.js';

function baseSchedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: 'sched_1',
    goal: 'هدف تجريبي',
    provider: 'anthropic',
    model: 'claude-x',
    recurrence: { type: 'interval', everyMs: 60_000 },
    enabled: true,
    lastRunAt: null,
    lastStatus: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

test('a disabled schedule is never due, regardless of recurrence', () => {
  const s = baseSchedule({ enabled: false, recurrence: { type: 'interval', everyMs: 1 }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), false);
});

// ---- interval ----

test('interval: due immediately when it has never run', () => {
  const s = baseSchedule({ recurrence: { type: 'interval', everyMs: 60_000 }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), true);
});

test('interval: NOT due before everyMs has elapsed since lastRunAt', () => {
  const now = Date.now();
  const s = baseSchedule({ recurrence: { type: 'interval', everyMs: 60_000 }, lastRunAt: now - 30_000 });
  assert.equal(computeIsDue(s, now), false);
});

test('interval: due once everyMs has genuinely elapsed', () => {
  const now = Date.now();
  const s = baseSchedule({ recurrence: { type: 'interval', everyMs: 60_000 }, lastRunAt: now - 60_001 });
  assert.equal(computeIsDue(s, now), true);
});

test('interval: a malformed recurrence (everyMs: 0 or missing) is never due, not a crash', () => {
  const s = baseSchedule({ recurrence: { type: 'interval', everyMs: 0 }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), false);
});

// ---- once ----

test('once: due once its target timestamp has passed and it has never run', () => {
  const s = baseSchedule({ recurrence: { type: 'once', at: new Date(Date.now() - 1000).toISOString() }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), true);
});

test('once: NOT due before its target timestamp arrives', () => {
  const s = baseSchedule({ recurrence: { type: 'once', at: new Date(Date.now() + 60_000).toISOString() }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), false);
});

test('once: NEVER due again after it has already run, even long after its target time — "once" means once', () => {
  const s = baseSchedule({ recurrence: { type: 'once', at: new Date(Date.now() - 1000).toISOString() }, lastRunAt: Date.now() - 500 });
  assert.equal(computeIsDue(s, Date.now()), false);
});

test('once: a malformed/missing "at" is never due, not a crash', () => {
  const s = baseSchedule({ recurrence: { type: 'once' }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), false);
});

// ---- daily ----

test("daily: NOT due before today's target hour/minute has arrived", () => {
  const now = new Date();
  now.setHours(10, 0, 0, 0);
  const s = baseSchedule({ recurrence: { type: 'daily', hour: 14, minute: 0 }, lastRunAt: null });
  assert.equal(computeIsDue(s, now.getTime()), false);
});

test("daily: due once today's target time has arrived and it has never run", () => {
  const now = new Date();
  now.setHours(14, 5, 0, 0);
  const s = baseSchedule({ recurrence: { type: 'daily', hour: 14, minute: 0 }, lastRunAt: null });
  assert.equal(computeIsDue(s, now.getTime()), true);
});

test('daily: NOT due again the same day after it already ran today, even though the target time has passed', () => {
  const now = new Date();
  now.setHours(14, 30, 0, 0);
  const todayTarget = new Date(now);
  todayTarget.setHours(14, 0, 0, 0);
  const s = baseSchedule({ recurrence: { type: 'daily', hour: 14, minute: 0 }, lastRunAt: todayTarget.getTime() + 60_000 }); // ran once, just after today's slot
  assert.equal(computeIsDue(s, now.getTime()), false);
});

test("daily: due again once a new day's target time arrives, even though it ran yesterday", () => {
  const now = new Date();
  now.setHours(14, 5, 0, 0);
  const yesterdayRun = now.getTime() - 24 * 60 * 60_000; // ran at roughly the same time yesterday
  const s = baseSchedule({ recurrence: { type: 'daily', hour: 14, minute: 0 }, lastRunAt: yesterdayRun });
  assert.equal(computeIsDue(s, now.getTime()), true);
});

test('daily: a malformed recurrence (missing hour/minute) is never due, not a crash', () => {
  const s = baseSchedule({ recurrence: { type: 'daily' }, lastRunAt: null });
  assert.equal(computeIsDue(s, Date.now()), false);
});
