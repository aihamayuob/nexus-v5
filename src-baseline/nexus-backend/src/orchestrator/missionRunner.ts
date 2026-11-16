import { getRepos } from '../persistence/repos.js';
import { ServerConfig } from '../config/env.js';
import { newTaskId } from '../core/ids.js';
import { logger } from '../core/logger.js';
import { normalizeError, Errors } from '../core/errors.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { TaskObservability } from '../observability/recorder.js';
import { claimTask, getAbortSignalFor, releaseTask, acquireGlobalSlot, cancelTask, consumePauseRequest } from './taskManager.js';
import { getStreamRegistry } from './streamRegistry.js';
import { ExecutionCheckpoint } from './checkpoint.js';
import { executeDag } from './dag.js';
import { createAgentDagRunner } from './agentDagRunner.js';
import { planGoal } from './planner.js';
import { Verifier } from './verifier.js';
import { requestApproval } from './approvalGate.js';
import { selectProviderForMode } from '../providers/routingModes.js';
import { analyzeIntent } from '../intent/intentEngine.js';
import type { ProviderId } from '../config/providerRegistry.js';
import type { DagPlan } from './dagTypes.js';
import type { CompletionCriteria, Mission } from './missionTypes.js';

export interface CreateMissionOptions {
  completionCriteria?: CompletionCriteria;
  maxReplans?: number;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}

const DEFAULT_COMPLETION_CRITERIA: CompletionCriteria = { requireAllTasksDone: true, requireVerificationOk: false, minTaskSuccessRatio: 1 };
/** Hard ceiling independent of whatever a caller passes — Phase 2 §A: "لا تسمح بـunbounded execution أو retry loops" applies even to a caller-supplied maxReplans. */
const HARD_MAX_REPLANS = 3;

/** Creates the Mission (+ its underlying task row) but does not run it — matches claimTask()/dispatch's existing two-step split so a route layer can attach a stream listener before anything is emitted. */
export function createMission(objective: string, ctx: GatewayContext, opts: CreateMissionOptions = {}): { missionId: string; reusedExisting: boolean } {
  if (!objective.trim()) throw Errors.validation('الحقل "objective" مطلوب.');
  const maxReplans = Math.min(opts.maxReplans ?? 1, HARD_MAX_REPLANS);
  const { taskId, reusedExisting } = claimTask('runtime_plan', opts.idempotencyKey ?? null, ctx, { promptLen: objective.length });
  if (!reusedExisting) {
    getRepos().missions.create({
      id: taskId,
      objective,
      completionCriteria: { ...DEFAULT_COMPLETION_CRITERIA, ...opts.completionCriteria },
      maxReplans,
      metadata: opts.metadata ?? {},
    });
  }
  return { missionId: taskId, reusedExisting };
}

/** Runs (or resumes) a Mission end-to-end: Planning -> Execution -> bounded Replanning -> Evaluation -> Correction -> Verification -> Completion. Fires in the background; callers poll mission/task status the same way runPlanTask's callers already do. */
export async function runMission(missionId: string, ctx: GatewayContext): Promise<void> {
  const repos = getRepos();
  const mission = repos.missions.get(missionId);
  if (!mission) throw Errors.notFound('Mission غير موجودة.');

  const signal = getAbortSignalFor(missionId);
  const streamRegistry = getStreamRegistry();
  const obs = new TaskObservability(missionId, 'runtime_plan');
  // Dedicated resilience-gap fix: `release` and `hardTimeout` used to be
  // assigned by a synchronous prelude BEFORE the try block below even
  // started — including `await acquireGlobalSlot(signal)`, which throws a
  // real error (Errors.cancelled() if aborted while waiting, or
  // Errors.rateLimited('server busy') after a 5s wait with no free slot
  // under real concurrent load) that is NOT a hang, NOT a crash inside
  // executeDag, just a normal, expected backpressure signal. But because
  // it threw before the try/catch even began, that error propagated
  // straight out of runMission() itself — and runMission() is invoked
  // fire-and-forget (`void runPromise` in autonomousCore.ts, same
  // contract as taskManager.ts's runPlanTask() dispatch), so nothing was
  // ever awaiting or .catch()-ing this specific promise. The result: a
  // genuine unhandled promise rejection — which, in production Node.js
  // (v15+) with no global unhandledRejection handler anywhere in this
  // codebase, TERMINATES THE ENTIRE PROCESS. Confirmed empirically: firing
  // more concurrent missions than NEXUS_MAX_CONCURRENCY and letting the
  // excess ones wait past the 5s ceiling reliably reproduces the
  // unhandled rejection (previously masked in every prior resilience
  // pass only because test processes exited before that 5s timer fired).
  // Fix: `release`/`hardTimeout` are now nullable and only assigned
  // inside the try block below, and acquireGlobalSlot() itself now runs
  // inside that same try — so a slot-wait failure now takes the EXACT
  // same, already-tested path as any other early mission failure (e.g.
  // planForMission() throwing): caught below, mission cleanly transitioned
  // to FAILED with a real reason recorded, no crash, no silently-stuck
  // mission.
  let release: (() => void) | null = null;
  let hardTimeout: NodeJS.Timeout | null = null;
  let awaitingApproval = false;
  try {
    release = await acquireGlobalSlot(signal);
    streamRegistry.reopen(missionId); // Slice 13: harmless for a first run; required so a manually-resumed (same-process) mission's stream isn't seen as already-finished — see streamRegistry.ts's reopen() doc comment
    repos.tasks.updateStatus(missionId, 'running');

    // Same whole-mission wall-clock ceiling runPlanTask() already enforces
    // for plain plans — reuses cancelTask() (the same function /v2/tasks'
    // cancel route calls) rather than reaching into taskManager's private
    // AbortController map directly.
    hardTimeout = setTimeout(() => {
      logger.warn('Mission exceeded wall-clock ceiling — aborting', { missionId });
      cancelTask(missionId);
    }, ServerConfig.planTimeoutMs);

    let plan = await planForMission(mission.objective, missionId, obs, signal);
    await ExecutionCheckpoint.save(missionId, 'plan_definition', plan);
    repos.missions.transition(missionId, 'RUNNING', 'بدأ التنفيذ بعد التخطيط.');

    let execResult = await execute(missionId, plan, ctx, obs, signal, streamRegistry);

    // Bounded replanning — Autonomous Core §C's "Replanning Hook": only
    // triggers when EVERY task failed (a partial success is handled by
    // completion-criteria evaluation below, not replanning), and only up
    // to mission.maxReplans times, each one a fresh planGoal() call, never
    // a silent unbounded loop.
    while (execResult.allFailed && repos.missions.get(missionId)!.replanCount < mission.maxReplans) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      repos.missions.transition(missionId, 'REPLANNING', 'فشلت جميع المهام — إعادة تخطيط محدودة.');
      streamRegistry.emit(missionId, 'replanning', { attempt: repos.missions.incrementReplanCount(missionId) });
      plan = await planForMission(
        `${mission.objective}\n\n(محاولة سابقة فشلت بالكامل — أعد التخطيط بمقاربة مختلفة فعلياً، لا تكرر نفس التجزئة.)`,
        missionId,
        obs,
        signal
      );
      await ExecutionCheckpoint.save(missionId, 'plan_definition', plan);
      repos.missions.transition(missionId, 'RUNNING', 'إعادة التنفيذ بعد إعادة التخطيط.');
      execResult = await execute(missionId, plan, ctx, obs, signal, streamRegistry);
    }

    const totalRetries = Object.values(execResult.nodeStates).reduce((sum, s) => sum + Math.max(0, s.attempt - 1), 0);
    repos.missions.setRetryCount(missionId, totalRetries);

    if (execResult.allFailed) {
      for (const [nodeId, s] of Object.entries(execResult.nodeStates)) {
        if (s.status === 'failed' && s.error) {
          repos.missions.appendFailure(missionId, { source: nodeId, message: s.error, at: Date.now() });
        }
      }
      repos.missions.appendFailure(missionId, { source: 'dag', message: 'فشلت جميع المهام الفرعية بعد كل محاولات إعادة التخطيط المتاحة.', at: Date.now() });
      repos.missions.transition(missionId, 'FAILED', 'فشلت جميع المهام الفرعية.');
      streamRegistry.emit(missionId, 'plan_error', { message: 'فشلت جميع المهام الفرعية.' });
      repos.tasks.updateStatus(missionId, 'failed', 'all subtasks failed');
      obs.finish('failed');
      return;
    }

    // Evaluation Hook (pre-correction check) + Correction Hook (bounded,
    // ONE re-synthesis attempt) + Verification Hook (final, post-correction
    // check) — three distinct, real calls, not the same call reused three
    // times: evaluation happens on the FIRST synthesis, verification on
    // whatever synthesis (corrected or not) actually ships.
    let finalOutput = execResult.finalOutput ?? '';
    const requiresVerification =
      mission.completionCriteria.runVerification === true ||
      mission.completionCriteria.requireVerificationOk === true ||
      mission.completionCriteria.requireApprovalOnIssues === true;
    let evaluation = null as Awaited<ReturnType<typeof Verifier.verify>> | null;
    let verification = null as Awaited<ReturnType<typeof Verifier.verify>> | null;

    if (requiresVerification) {
      evaluation = await Verifier.verify(mission.objective, finalOutput, { taskId: missionId });
      streamRegistry.emit(missionId, 'verification', { stage: 'evaluation', ...evaluation });

      if (evaluation.ran && evaluation.verdict === 'issues_found') {
        const runner = createAgentDagRunner(ctx, obs, missionId);
        const doneResults = Object.fromEntries(
          Object.entries(execResult.nodeStates)
            .filter(([, s]) => s.status === 'done' && s.output != null)
            .map(([id, s]) => [id, s.output as string])
        );
        try {
          finalOutput = await runner.synthesize(
            `${mission.objective}\n\n(مراجعة مستقلة وجدت ملاحظات يجب معالجتها: ${evaluation.issues.join('؛ ')})`,
            doneResults,
            () => {},
            signal
          );
        } catch (e) {
          // Correction is a best-effort improvement, not a hard requirement — keep the pre-correction output on failure rather than losing the mission's work.
          logger.warn('Correction hook failed (non-fatal — keeping prior output)', { missionId, message: (e as Error).message });
        }
      }

      verification = await Verifier.verify(mission.objective, finalOutput, { taskId: missionId });
      streamRegistry.emit(missionId, 'verification', { stage: 'final', ...verification });
    }

    const completionOk = checkCompletionCriteria(mission.completionCriteria, execResult.nodeStates, verification);
    repos.missions.setResult(missionId, { finalOutput, evaluation, verification });

    // Warden Hook (Phase 3): a human-in-the-loop gate BEFORE automatic
    // completion, distinct from the completion-criteria check below — this
    // holds even output that WOULD otherwise satisfy completion criteria,
    // whenever the caller opted in via requireApprovalOnIssues and the
    // final (post-correction) verification pass still found issues. Reuses
    // the exact same approvalGate.ts/`/v2/approvals` flow every other
    // HIGH_RISK task already uses — nothing new invented for this path.
    if (mission.completionCriteria.requireApprovalOnIssues && verification?.ran && verification.verdict === 'issues_found') {
      repos.missions.transition(missionId, 'AWAITING_APPROVAL', 'مراجعة نهائية وجدت ملاحظات — بانتظار قرار بشري.');
      requestApproval(missionId, finalOutput, `تحقق نهائي وجد ${verification.issues.length} ملاحظة: ${verification.issues.join('؛ ')}`);
      obs.finish('ok'); // matches taskManager.ts's existing precedent for the HIGH_RISK/requestApproval() path — "held for a human decision" is a successful hand-off, not a failure or cancellation
      return; // task/mission stay non-terminal until POST /v2/approvals/:taskId/decide is called — see approvalGate.ts's decideApproval() for the mission-state sync on decision
    }

    if (!completionOk) {
      repos.missions.appendFailure(missionId, { source: 'completion_criteria', message: 'لم تتحقق معايير الإكمال المطلوبة.', at: Date.now() });
      repos.missions.transition(missionId, 'FAILED', 'لم تتحقق معايير الإكمال.');
      streamRegistry.emit(missionId, 'plan_error', { message: 'لم تتحقق معايير الإكمال المطلوبة.' });
      repos.tasks.updateStatus(missionId, 'failed', 'completion criteria not met');
      obs.finish('failed');
      return;
    }

    repos.missions.transition(missionId, 'COMPLETED', 'تحققت معايير الإكمال.');
    streamRegistry.emit(missionId, 'plan_done', { finalOutput });
    repos.tasks.updateStatus(missionId, 'done');
    await ExecutionCheckpoint.clear(missionId);
    obs.finish('ok');
  } catch (e) {
    const err = normalizeError(e);
    if (err.code === 'cancelled' || (e as Error)?.name === 'AbortError') {
      // Phase 3 Slice 13 (Warden PAUSE/RESUME): the SAME AbortError path
      // cancellation already used now branches on WHY the signal fired.
      // consumePauseRequest() is one-shot (see taskManager.ts) — reading
      // it here is safe even though checkpoint state (dag_nodes,
      // plan_definition) is left exactly as executeDag()/ExecutionCheckpoint
      // wrote it, i.e. nothing extra to clean up for a pause vs a cancel.
      if (consumePauseRequest(missionId)) {
        repos.missions.transition(missionId, 'PAUSED', 'أُوقفت المهمة مؤقتاً (Pause) بطلب بشري عبر Warden.');
        streamRegistry.emit(missionId, 'mission_paused', {});
        // Deliberately NOT repos.tasks.updateStatus(missionId, 'cancelled')
        // here — the underlying task is not cancelled, it's paused, and
        // the tasks.status enum (pending|running|done|failed|cancelled)
        // has no 'paused' value of its own (documented pre-existing
        // constraint, not silently worked around). Mission.state is the
        // authoritative signal for PAUSED; GET /v2/missions/:id already
        // reports `state` and `taskStatus` as two separate fields, so a
        // caller sees state=PAUSED regardless of the task row underneath.
        obs.finish('cancelled');
      } else {
        repos.missions.transition(missionId, 'CANCELLED', 'أُلغيت المهمة.');
        streamRegistry.emit(missionId, 'plan_error', { message: 'أُلغيت المهمة.' });
        repos.tasks.updateStatus(missionId, 'cancelled');
        obs.finish('cancelled');
      }
    } else {
      logger.error('Mission failed unexpectedly', { missionId, message: err.message });
      repos.missions.appendFailure(missionId, { source: 'mission_runner', message: err.message, at: Date.now() });
      repos.missions.transition(missionId, 'FAILED', err.message);
      streamRegistry.emit(missionId, 'plan_error', { message: err.message });
      repos.tasks.updateStatus(missionId, 'failed', err.message);
      obs.recordFailure(err.message);
      obs.finish('failed');
    }
  } finally {
    if (hardTimeout) clearTimeout(hardTimeout);
    if (!awaitingApproval) streamRegistry.markDone(missionId);
    releaseTask(missionId);
    if (release) release();
  }
}

async function planForMission(objective: string, missionId: string, _obs: TaskObservability, signal?: AbortSignal): Promise<DagPlan> {
  // Autonomous Core §C, stage 2 (Intent): a real classification, not a
  // stub — feeds the SAME risk/complexity signal executionPolicy.ts
  // already uses for the fast-path/plan-path decision into Model
  // Selection for planning itself, so a high-risk or high-complexity
  // objective doesn't get planned by whatever provider happened to be
  // fastest for a trivial request.
  const intent = analyzeIntent(objective);
  const routed = await selectProviderForMode({ mode: 'BEST', intent: { complexity: intent.complexity, risk: intent.risk } });
  return planGoal(objective, routed.provider as ProviderId, signal);
}

async function execute(
  missionId: string,
  plan: DagPlan,
  ctx: GatewayContext,
  obs: TaskObservability,
  signal: AbortSignal,
  streamRegistry: ReturnType<typeof getStreamRegistry>
) {
  const repos = getRepos();
  const runner = createAgentDagRunner(ctx, obs, missionId);
  return executeDag({
    taskId: missionId,
    plan,
    emit: (event, data) => streamRegistry.emit(missionId, event, data),
    runNode: runner.runNode,
    reflect: runner.reflect,
    reviseNode: runner.reviseNode,
    synthesize: runner.synthesize,
    persistNode: (node) => repos.checkpoints.upsertNode({ taskId: missionId, ...node }),
    maxConcurrency: ServerConfig.maxConcurrencyPerPlan,
    maxRetries: ServerConfig.maxRetries,
    timeoutMs: ServerConfig.defaultTaskTimeoutMs,
    signal,
  });
}

function checkCompletionCriteria(
  criteria: CompletionCriteria,
  nodeStates: Record<string, { status: string }>,
  verification: Awaited<ReturnType<typeof Verifier.verify>> | null
): boolean {
  const states = Object.values(nodeStates);
  const doneCount = states.filter((s) => s.status === 'done').length;
  const ratio = states.length ? doneCount / states.length : 0;

  if (criteria.requireAllTasksDone !== false && doneCount < states.length) return false;
  if (typeof criteria.minTaskSuccessRatio === 'number' && ratio < criteria.minTaskSuccessRatio) return false;
  if (criteria.requireVerificationOk && (!verification || !verification.ran || verification.verdict !== 'ok')) return false;
  return true;
}

/**
 * Missions left non-terminal by an unclean shutdown — mission-layer
 * counterpart to taskManager.ts's resumeInterruptedPlans(). Called once at
 * process startup (see index.ts). Phase 3 Slice 13: uses
 * interruptedMissionIds() (NOT resumableMissionIds()) specifically so a
 * mission a human deliberately PAUSED via Warden stays PAUSED across a
 * restart instead of being silently auto-resumed here — see
 * missionRepo.ts's interruptedMissionIds() doc comment.
 */
export async function resumeInterruptedMissions(): Promise<void> {
  const repos = getRepos();
  const missionIds = repos.missions.interruptedMissionIds();
  for (const missionId of missionIds) {
    const task = repos.tasks.get(missionId);
    const mission = repos.missions.get(missionId);
    if (!task || !mission) continue;
    const checkpoint = ExecutionCheckpoint.latest(missionId);
    if (!checkpoint || checkpoint.phase !== 'plan_definition') {
      logger.warn('Cannot resume mission — no persisted plan definition found, leaving for manual retry', { missionId });
      continue;
    }
    logger.info('Resuming interrupted mission', { missionId, state: mission.state });
    const ctx: GatewayContext = { authenticated: true, clientKey: 'system-resume', projectId: task.projectId, userId: task.userId };
    void runMission(missionId, ctx).catch((e) => logger.error('Mission resume failed', { missionId, message: (e as Error).message }));
  }
}
