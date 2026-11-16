import { getRepos } from '../persistence/repos.js';
import { runAutonomousMission } from '../orchestrator/autonomousCore.js';
import { detectRepeatedFailurePatterns } from '../metacognition/metaCognition.js';
import { logger } from '../core/logger.js';
import type { ScheduleRecord } from '../persistence/repositories/scheduleRepo.js';
import type { GatewayContext } from '../capability/permissionModel.js';

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const SchedulerConfig = {
  loopIntervalMs: num('NEXUS_SCHEDULER_INTERVAL_MS', 60_000),
  metaCogSweepWindowMs: num('NEXUS_METACOG_SWEEP_WINDOW_MS', 24 * 60 * 60_000),
  metaCogSweepMinCount: num('NEXUS_METACOG_SWEEP_MIN_COUNT', 3),
};

/** A system-level GatewayContext for background-dispatched work with no originating HTTP request — same shape every route's authenticate() would have produced, just without a real client key. */
const SYSTEM_CTX: GatewayContext = { authenticated: true, clientKey: 'system:scheduler', projectId: null, userId: null };

/**
 * Real due-check logic — no placeholder, no "always true". This is the
 * piece that was entirely missing before this slice: routes/legacy/
 * schedules.ts only ever did CRUD on the `schedules` table; nothing
 * anywhere read `recurrence`/`lastRunAt` to decide whether a schedule
 * should actually fire. Exported standalone (not buried in the loop) so
 * it's independently unit-testable without spinning up a timer.
 */
export function computeIsDue(schedule: ScheduleRecord, now: number): boolean {
  if (!schedule.enabled) return false;
  const r = schedule.recurrence;

  if (r.type === 'once') {
    if (schedule.lastRunAt !== null) return false; // already ran — 'once' means once, not "every tick after its time has passed"
    if (!r.at) return false; // malformed row — never crash the loop over one bad schedule
    const target = Date.parse(r.at);
    return Number.isFinite(target) && now >= target;
  }

  if (r.type === 'interval') {
    if (!r.everyMs || r.everyMs <= 0) return false;
    if (schedule.lastRunAt === null) return true; // never run yet — due immediately
    return now - schedule.lastRunAt >= r.everyMs;
  }

  if (r.type === 'daily') {
    if (r.hour === undefined || r.minute === undefined) return false;
    const nowDate = new Date(now);
    const todayTarget = new Date(nowDate);
    todayTarget.setHours(r.hour, r.minute, 0, 0);
    if (nowDate.getTime() < todayTarget.getTime()) return false; // today's slot hasn't arrived yet
    // Due if never run, or the last run was before TODAY's target slot (so it fires once per day, not once per loop tick after the target time).
    return schedule.lastRunAt === null || schedule.lastRunAt < todayTarget.getTime();
  }

  return false;
}

/**
 * Dispatches every real due schedule via runAutonomousMission() — the
 * EXACT SAME Phase 2 pipeline every other mission goes through (Model
 * Selection, Agent Runtime, Verification, Warden-audited cancellation
 * all apply identically to a scheduled mission; nothing here bypasses
 * any of it). Each dispatch is independent — one schedule throwing never
 * blocks or crashes the sweep for the others.
 */
export async function runDueSchedules(now: number = Date.now()): Promise<{ dispatched: string[] }> {
  const repos = getRepos();
  const due = repos.schedules.list().filter((s) => computeIsDue(s, now));
  const dispatched: string[] = [];

  for (const schedule of due) {
    try {
      await runAutonomousMission(schedule.goal, SYSTEM_CTX, { metadata: { scheduleId: schedule.id } });
      repos.schedules.recordRun(schedule.id, 'success');
      dispatched.push(schedule.id);
    } catch (e) {
      // record + log, but never let one bad schedule stop the sweep
      repos.schedules.recordRun(schedule.id, 'error');
      logger.error('Scheduled mission dispatch failed', { scheduleId: schedule.id, message: (e as Error).message });
    }
  }
  return { dispatched };
}

/** Zero LLM calls, real SQL aggregation only — safe to run on every loop tick regardless of interval length, since it's cheap and idempotent-by-design (see ImprovementProposalRepo.hasOpenProposalFor()'s dedup guard). */
export function runMetaCognitionSweep(): void {
  try {
    const created = detectRepeatedFailurePatterns(SchedulerConfig.metaCogSweepWindowMs, SchedulerConfig.metaCogSweepMinCount);
    if (created.length) logger.info('MetaCognition sweep found new repeated-failure patterns', { count: created.length, agentIds: created.map((p) => p.subjectId) });
  } catch (e) {
    logger.error('MetaCognition sweep failed (non-fatal)', { message: (e as Error).message });
  }
}

async function runSweepOnce(): Promise<void> {
  try {
    await runDueSchedules();
  } catch (e) {
    logger.error('Schedule sweep failed (non-fatal)', { message: (e as Error).message });
  }
  runMetaCognitionSweep();
}

/** Same startup/shutdown contract as observability/retention.ts's startRetentionSweeper() — one immediate sweep, then a real setInterval loop; caller is responsible for clearInterval() on shutdown (see index.ts). */
export function startSchedulerLoop(intervalMs: number = SchedulerConfig.loopIntervalMs): NodeJS.Timeout {
  void runSweepOnce();
  return setInterval(() => void runSweepOnce(), intervalMs);
}
