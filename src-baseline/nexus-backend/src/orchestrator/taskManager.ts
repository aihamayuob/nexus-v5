import { ServerConfig } from '../config/env.js';
import { Errors } from '../core/errors.js';
import { newTaskId } from '../core/ids.js';
import { logger } from '../core/logger.js';
import { getRepos } from '../persistence/repos.js';
import type { TaskKind } from '../persistence/repositories/taskRepo.js';
import { TaskObservability } from '../observability/recorder.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { getStreamRegistry } from './streamRegistry.js';
import { ExecutionCheckpoint } from './checkpoint.js';
import { executeDag } from './dag.js';
import { createDagRunner } from './dagRunner.js';
import { requestApproval } from './approvalGate.js';
import type { DagPlan } from './dagTypes.js';
import type { ProviderId } from '../config/providerRegistry.js';

const running = new Map<string, true>();

/**
 * Enforces the process-wide concurrency ceiling. This is a real limit on
 * simultaneously in-flight tasks (not per-provider) — see
 * ServerConfig.maxConcurrency. A task waits here (not rejected outright)
 * up to a short grace period, then is rejected with 429 if the system is
 * still saturated, matching how the rate limiter also communicates
 * backpressure rather than silently queuing forever.
 */
export async function acquireGlobalSlot(signal?: AbortSignal): Promise<() => void> {
  const start = Date.now();
  while (running.size >= ServerConfig.maxConcurrency) {
    if (signal?.aborted) throw Errors.cancelled();
    if (Date.now() - start > 5000) throw Errors.rateLimited('الخادم مشغول بأقصى طاقته الآن — أعد المحاولة خلال لحظات.');
    await new Promise((r) => setTimeout(r, 100));
  }
  const key = `${Date.now()}_${Math.random()}`;
  running.set(key, true);
  return () => running.delete(key);
}

export function cancelTask(taskId: string): boolean {
  const t = activeAbortControllers.get(taskId);
  if (!t) return false;
  t.abort();
  return true;
}

const activeAbortControllers = new Map<string, AbortController>();

/**
 * Phase 3 Slice 13 (Warden PAUSE/RESUME) — a real running task's execution
 * is interrupted via the EXACT SAME abort-signal mechanism cancelTask()
 * already uses (no second cancellation pathway invented), but the intent
 * is recorded first in `pauseRequested` so the caller (missionRunner.ts's
 * catch block) can tell "this AbortError means PAUSE" apart from "this
 * AbortError means CANCEL" and transition the Mission to the correct
 * state accordingly. Returns false (same contract as cancelTask()) when
 * there is no live in-process execution to interrupt — the caller (Warden)
 * decides what to do in that case.
 */
const pauseRequested = new Map<string, true>();

export function requestPause(taskId: string): boolean {
  const t = activeAbortControllers.get(taskId);
  if (!t) return false;
  pauseRequested.set(taskId, true);
  t.abort();
  return true;
}

/** One-shot read: returns whether a pause (as opposed to a plain cancel) was requested for this taskId, and clears the flag either way so it can never leak into a later, unrelated run of the same id. */
export function consumePauseRequest(taskId: string): boolean {
  const was = pauseRequested.has(taskId);
  pauseRequested.delete(taskId);
  return was;
}

export interface StartTaskResult {
  taskId: string;
  reusedExisting: boolean;
}

/** Idempotency: if a task with this key already exists, its id is reused instead of starting a duplicate. */
export function claimTask(kind: TaskKind, idempotencyKey: string | null, ctx: GatewayContext, meta: { provider?: string; model?: string; promptLen?: number }): StartTaskResult {
  const repos = getRepos();
  if (idempotencyKey) {
    const existingId = repos.idempotency.find(idempotencyKey);
    if (existingId) {
      const existing = repos.tasks.get(existingId);
      if (existing && (existing.status === 'pending' || existing.status === 'running')) {
        return { taskId: existingId, reusedExisting: true };
      }
    }
  }
  const taskId = newTaskId(kind === 'chat' ? 'chat' : 'plan');
  repos.tasks.create({
    id: taskId,
    kind,
    idempotencyKey,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
    goalOrPromptLen: meta.promptLen ?? null,
    projectId: ctx.projectId,
    userId: ctx.userId,
    errorMessage: null,
  });
  if (idempotencyKey) repos.idempotency.claim(idempotencyKey, taskId);
  return { taskId, reusedExisting: false };
}

export function getAbortSignalFor(taskId: string): AbortSignal {
  let ac = activeAbortControllers.get(taskId);
  if (!ac) {
    ac = new AbortController();
    activeAbortControllers.set(taskId, ac);
  }
  return ac.signal;
}

export function releaseTask(taskId: string) {
  activeAbortControllers.delete(taskId);
}

/**
 * Runs a whole Agent Runtime plan (the DAG) as ONE durable, resumable,
 * observable, budget-and-concurrency-governed task — this is the
 * unification the audit called for: /api/runtime/plan + /api/runtime/run
 * no longer sit beside Nexus Core as a separate path, they ARE a task
 * kind the same Task Manager governs like any other.
 *
 * `requireApproval` (Phase 3 — Execution Policy HIGH_RISK tier): when
 * true, the DAG still runs to completion (research, verification,
 * synthesis all happen normally) but the FINAL result is held behind a
 * human approval gate instead of being delivered — see
 * orchestrator/approvalGate.ts. The stream emits `approval_required`
 * instead of `plan_done`; the eventual approve/reject decision emits the
 * real `plan_done`/`plan_error` later via the same durable stream log, so
 * a client that resumed/polled after approval sees it exactly like any
 * other stream event.
 */
export async function runPlanTask(
  taskId: string,
  plan: DagPlan,
  providerId: ProviderId,
  ctx: GatewayContext,
  resumeFrom?: Array<{ nodeId: string; status: 'done'; output: string | null }>,
  requireApproval = false
): Promise<void> {
  const repos = getRepos();
  const signal = getAbortSignalFor(taskId);
  const streamRegistry = getStreamRegistry();
  const obs = new TaskObservability(taskId, 'runtime_plan');
  // Dedicated resilience-gap fix (same class of bug as missionRunner.ts's
  // runMission() — see its comment for the full rationale): `release` and
  // `planTimeout` used to be assigned by code that ran BEFORE this
  // function's try block even started, including `await
  // acquireGlobalSlot(signal)`. A slot-wait failure there (real
  // Errors.rateLimited() after 5s under real concurrent load — expected
  // backpressure, not a crash) used to escape runPlanTask() entirely
  // uncaught. That's safe for the one caller that already wraps this call
  // in its own try/catch (taskEntryPoint.ts's dispatch()), but NOT for
  // /api/runtime/run in routes/legacy/runtime.ts, which awaits
  // runPlanTask() directly with no enclosing try/catch of its own — relying
  // entirely on this function to handle its own failures, exactly as its
  // own comment above states ("runPlanTask manages its own
  // task-status/observability/checkpoint lifecycle"). `release` and
  // `planTimeout` are now nullable and only assigned inside the try block,
  // with acquireGlobalSlot() itself moved inside it too — so a slot-wait
  // failure now takes the same already-tested path as any other
  // in-flight plan failure.
  let release: (() => void) | null = null;
  let planTimeout: NodeJS.Timeout | null = null;
  let awaitingApproval = false;
  try {
    release = await acquireGlobalSlot(signal);
    repos.tasks.updateStatus(taskId, 'running');

    planTimeout = setTimeout(() => {
      activeAbortControllers.get(taskId)?.abort();
    }, ServerConfig.planTimeoutMs);

    const runner = createDagRunner(providerId, ctx, obs, taskId);

    // Persist the plan's static shape (goal + task list) ONCE up front —
    // this is what makes resumeInterruptedPlans() below able to
    // reconstruct a MEANINGFUL plan.goal after a restart, instead of the
    // per-node dag_nodes rows alone (which only capture dynamic execution
    // state, not the original goal text). The goal is the user's own
    // request, not model reasoning/output, so persisting it doesn't
    // conflict with the "never log chain-of-thought" rule.
    await ExecutionCheckpoint.save(taskId, 'plan_definition', plan);

    const result = await executeDag({
      taskId,
      plan,
      emit: (event, data) => streamRegistry.emit(taskId, event, data),
      runNode: runner.runNode,
      reflect: runner.reflect,
      reviseNode: runner.reviseNode,
      synthesize: runner.synthesize,
      persistNode: (node) => repos.checkpoints.upsertNode({ taskId, ...node }),
      maxConcurrency: ServerConfig.maxConcurrencyPerPlan,
      signal,
      resumeFrom,
    });

    if (result.allFailed) {
      streamRegistry.emit(taskId, 'plan_error', { message: 'فشلت جميع المهام الفرعية.' });
      repos.tasks.updateStatus(taskId, 'failed', 'all subtasks failed');
      obs.finish('failed');
    } else if (requireApproval) {
      // Execution Policy HIGH_RISK tier: the work is genuinely done
      // (research, verification, synthesis all completed normally above)
      // but delivery is held for a human decision instead of an automatic
      // plan_done. Task status intentionally stays 'running' — it isn't
      // finished from the system's point of view until approved/rejected.
      requestApproval(taskId, result.finalOutput ?? '', 'تصنيف عالي الحساسية بواسطة سياسة التنفيذ (Execution Policy).');
      awaitingApproval = true;
      obs.finish('ok');
    } else {
      streamRegistry.emit(taskId, 'plan_done', { finalOutput: result.finalOutput });
      repos.tasks.updateStatus(taskId, 'done');
      await ExecutionCheckpoint.clear(taskId);
      obs.finish('ok');
    }
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      streamRegistry.emit(taskId, 'plan_error', { message: 'أُلغيت المهمة.' });
      repos.tasks.updateStatus(taskId, 'cancelled');
      obs.finish('cancelled');
    } else {
      logger.error('Plan task failed unexpectedly', { taskId, message: err.message });
      streamRegistry.emit(taskId, 'plan_error', { message: err.message });
      repos.tasks.updateStatus(taskId, 'failed', err.message);
      obs.recordFailure(err.message);
      obs.finish('failed');
    }
  } finally {
    if (planTimeout) clearTimeout(planTimeout);
    // While awaiting a human decision, the task/stream aren't "done" yet
    // — see approvalGate.ts, which marks the stream done itself once the
    // decision actually happens.
    if (!awaitingApproval) streamRegistry.markDone(taskId);
    releaseTask(taskId);
    if (release) release();
  }
}

/**
 * Resumes any plan tasks left non-terminal by an unclean shutdown — real
 * durable execution, not just a "something was interrupted" flag. Called
 * once at process startup (see index.ts).
 */
export async function resumeInterruptedPlans(): Promise<void> {
  const repos = getRepos();
  const taskIds = ExecutionCheckpoint.resumablePlanTaskIds();
  for (const taskId of taskIds) {
    const task = repos.tasks.get(taskId);
    if (!task || !task.provider) continue;
    const checkpoint = ExecutionCheckpoint.latest(taskId);
    if (!checkpoint || checkpoint.phase !== 'plan_definition') {
      logger.warn('Cannot resume plan — no persisted plan definition found, leaving for manual retry', { taskId });
      continue;
    }
    const plan = checkpoint.state as DagPlan;
    const nodes = repos.checkpoints.nodesForTask(taskId);
    logger.info('Resuming interrupted plan', { taskId, nodeCount: nodes.length, goalPreview: plan.goal.slice(0, 60) });
    const resumeFrom = nodes
      .filter((n): n is typeof n & { status: 'done' } => n.status === 'done')
      .map((n) => ({ nodeId: n.nodeId, status: n.status, output: n.output }));
    const ctx: GatewayContext = { authenticated: true, clientKey: 'system-resume', projectId: task.projectId, userId: task.userId };
    void runPlanTask(taskId, plan, task.provider as ProviderId, ctx, resumeFrom).catch((e) =>
      logger.error('Resume failed', { taskId, message: (e as Error).message })
    );
  }
}

export function taskManagerStatus() {
  return { runningCount: running.size, maxConcurrency: ServerConfig.maxConcurrency };
}
