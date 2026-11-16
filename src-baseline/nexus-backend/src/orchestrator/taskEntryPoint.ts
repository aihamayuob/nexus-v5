import type { ProviderId } from '../config/providerRegistry.js';
import type { ToolDef } from '../providers/contract.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { analyzeIntent } from '../intent/intentEngine.js';
import { decideExecutionPlan, type ExecutionPlanDecision } from '../intent/executionPolicy.js';
import { claimTask, getAbortSignalFor, releaseTask, runPlanTask } from './taskManager.js';
import { runChatCompletion } from './chatService.js';
import { TaskObservability } from '../observability/recorder.js';
import { getRepos } from '../persistence/repos.js';
import { planGoal } from './planner.js';
import { emitV2Event } from '../streaming/events.js';
import { getStreamRegistry } from './streamRegistry.js';
import { normalizeError } from '../core/errors.js';
import { idempotencyKeyFor } from '../core/ids.js';

export interface SubmitTaskOptions {
  tools?: ToolDef[];
  idempotencyKey?: string;
}

/**
 * Understand -> Intent -> Capability Selection -> Agent/Model Selection ->
 * Plan -> Parallel Execution -> Tools/Data -> Evidence -> Verification ->
 * Synthesis -> Decision -> Memory -> Evaluation -> Improvement — this
 * module is the "Understand -> ... -> Decision" half of that chain in one
 * place: it classifies the request ONCE (analyzeIntent + decideExecutionPlan)
 * and dispatches to whichever EXISTING machinery that tier actually needs.
 * It does not reimplement chat completion or DAG execution — those already
 * exist (chatService.ts, dag.ts) and are reused unmodified.
 *
 * Split into two steps deliberately: claimUnifiedTask() is synchronous and
 * only creates the task record (no events emitted yet), so the ROUTE layer
 * can attach its SseWriter to the stream registry BEFORE anything is
 * emitted. dispatchUnifiedTask() then emits `task_meta` and does the real
 * work. Emitting task_meta before the writer is attached would silently
 * lose that event for the connection that's about to ask for it — the
 * stream registry only broadcasts to writers already attached at emit
 * time (see streamRegistry.ts); this ordering is what makes that safe.
 */
export function claimUnifiedTask(
  input: string,
  providerId: ProviderId,
  ctx: GatewayContext,
  opts: SubmitTaskOptions = {}
): { taskId: string; decision: ExecutionPlanDecision; reusedExisting: boolean } {
  const needsTools = !!opts.tools && opts.tools.length > 0;
  const intent = analyzeIntent(input, { needsTools });
  const decision = decideExecutionPlan(intent);
  const kind = decision.tier === 'LOW' || decision.tier === 'MEDIUM' ? 'chat' : 'runtime_plan';
  const idemKey = idempotencyKeyFor(opts.idempotencyKey, { input, providerId, tier: decision.tier });
  const { taskId, reusedExisting } = claimTask(kind, idemKey, ctx, { provider: providerId, promptLen: input.length });
  return { taskId, decision, reusedExisting };
}

/** Emits `task_meta` and dispatches to the fast path or the DAG — call ONLY after the caller's SseWriter is already attached to taskId's stream (see claimUnifiedTask's doc comment). Fires the actual work in the background and returns immediately; the route layer awaits task completion by polling, same as runPlanTask's own callers do. */
export function dispatchUnifiedTask(
  taskId: string,
  decision: ExecutionPlanDecision,
  reusedExisting: boolean,
  input: string,
  providerId: ProviderId,
  ctx: GatewayContext,
  tools?: ToolDef[]
): void {
  emitV2Event(taskId, 'task_meta', {
    tier: decision.tier,
    useMultiAgent: decision.useMultiAgent,
    requireVerification: decision.requireVerification,
    requireApproval: decision.requireApproval,
    reasoning: decision.reasoning,
    reusedExisting,
  });

  if (reusedExisting) return;

  void dispatch(taskId, input, providerId, ctx, decision, tools).catch(() => {
    /* dispatch() already handles+records its own errors internally */
  });
}

async function dispatch(
  taskId: string,
  input: string,
  providerId: ProviderId,
  ctx: GatewayContext,
  decision: ExecutionPlanDecision,
  tools?: ToolDef[]
): Promise<void> {
  const repos = getRepos();
  if (decision.tier === 'LOW' || decision.tier === 'MEDIUM') {
    await runFastPath(taskId, input, providerId, ctx, decision, tools);
    return;
  }

  // HIGH / HIGH_RISK: full planner + parallel agents + verifier (+
  // approval gate for HIGH_RISK) — reuses planGoal()/runPlanTask()
  // exactly as /api/runtime/plan+run already do; this tier is NOT a
  // separate implementation, it's the same DAG machinery, just reached
  // through the policy decision instead of a manual two-step call.
  repos.tasks.updateStatus(taskId, 'running');
  try {
    const plan = await planGoal(input, providerId, getAbortSignalFor(taskId));
    await runPlanTask(taskId, plan, providerId, ctx, undefined, decision.requireApproval);
  } catch (e) {
    const err = normalizeError(e);
    repos.tasks.updateStatus(taskId, 'failed', err.message);
    emitV2Event(taskId, 'error', { message: err.message });
  }
}

async function runFastPath(
  taskId: string,
  input: string,
  providerId: ProviderId,
  ctx: GatewayContext,
  decision: ExecutionPlanDecision,
  tools?: ToolDef[]
): Promise<void> {
  const repos = getRepos();
  const signal = getAbortSignalFor(taskId);
  const obs = new TaskObservability(taskId, 'chat');
  repos.tasks.updateStatus(taskId, 'running');

  try {
    const result = await runChatCompletion(
      {
        provider: providerId,
        system: undefined,
        messages: [{ role: 'user', content: input }],
        tools: decision.useToolsAllowed ? tools : undefined,
        maxTokens: 1500,
        signal,
        route: 'chat',
        taskId,
      },
      ctx,
      obs,
      {
        onToken: (text) => emitV2Event(taskId, 'token', { text }),
        onToolUseStart: (b) => emitV2Event(taskId, 'tool_use_start', { id: b.id, name: b.name }),
        onToolUseDelta: (b) => emitV2Event(taskId, 'tool_use_delta', { id: b.id, partialJson: b.partialJson }),
      }
    );
    const textBlock = result.content.find((b) => b.type === 'text');
    emitV2Event(taskId, 'done', {
      finalOutput: textBlock && textBlock.type === 'text' ? textBlock.text : '',
      stopReason: result.stopReason,
    });
    repos.tasks.updateStatus(taskId, 'done');
    obs.finish('ok');
  } catch (e) {
    const err = normalizeError(e);
    emitV2Event(taskId, 'error', { message: err.message });
    repos.tasks.updateStatus(taskId, err.code === 'cancelled' ? 'cancelled' : 'failed', err.message);
    obs.recordFailure(err.message);
    obs.finish(err.code === 'cancelled' ? 'cancelled' : 'failed');
  } finally {
    releaseTask(taskId);
    getStreamRegistry().markDone(taskId);
  }
}
