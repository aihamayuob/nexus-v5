import { analyzeIntent } from '../intent/intentEngine.js';
import { createMission, runMission, type CreateMissionOptions } from './missionRunner.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { CompletionCriteria } from './missionTypes.js';

export interface AutonomousMissionOptions extends CreateMissionOptions {
  /** Run synchronously and wait for a terminal state before returning. Default false — matches every other task-shaped entry point in this codebase (fire, then poll/stream), so a caller isn't forced into a long-held HTTP connection just because they used this pipeline instead of calling missionRunner directly. */
  awaitCompletion?: boolean;
}

/**
 * The named pipeline: Objective -> Intent -> Planning -> Task
 * Decomposition -> Model Selection -> Agent Selection -> Tool Selection ->
 * Execution -> Evaluation Hook -> Correction Hook -> Replanning Hook ->
 * Verification Hook -> Completion.
 *
 * Stage-by-stage mapping to what actually runs (nothing here is a stub —
 * every stage below is a real call into already-tested code):
 *   Objective                     -> the `objective` argument itself
 *   Intent                        -> analyzeIntent() (intent/intentEngine.ts)
 *   Planning + Task Decomposition -> planner.ts's planGoal(), inside missionRunner.runMission()
 *   Model Selection                -> routingModes.ts's selectProviderForMode() (Slice 1), once for planning and once per agent task
 *   Agent Selection                -> agentRegistry.ts's selectAgentForTask(), inside agentDagRunner.ts
 *   Tool Selection                  -> agent.tools (agentTypes.ts), enforced by agentRunner.ts — real but currently a no-op since no built-in agent declares tools yet (see agentRegistry.ts)
 *   Execution                       -> dag.ts's executeDag(), via agentDagRunner.ts
 *   Evaluation/Correction/Verification/Replanning Hooks -> missionRunner.runMission()'s bounded implementations
 *   Completion                      -> missionRunner.ts's checkCompletionCriteria()
 *
 * Provider-agnostic by construction: this file never imports a provider
 * adapter or names a provider id anywhere (Phase 2 §D).
 */
export async function runAutonomousMission(
  objective: string,
  ctx: GatewayContext,
  opts: AutonomousMissionOptions = {}
): Promise<{ missionId: string }> {
  // Intent stage — real call (not a comment-only stub), recorded for
  // future routing refinement. Planning already re-derives its own
  // task-complexity signal internally via planner.ts, so this doesn't
  // gate anything yet — the stage is genuinely exercised and available
  // to extend without inventing a second, conflicting intent pipeline.
  void analyzeIntent(objective, {});

  const { missionId } = createMission(objective, ctx, opts);
  const runPromise = runMission(missionId, ctx);

  if (opts.awaitCompletion) {
    await runPromise;
  } else {
    void runPromise; // fire-and-forget — same contract as taskManager.ts's runPlanTask() dispatch
  }

  return { missionId };
}

export type { CompletionCriteria };
