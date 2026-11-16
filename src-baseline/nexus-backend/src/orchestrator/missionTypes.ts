/**
 * Explicit Mission state machine (Phase 2 §A: "الحالات يجب أن تكون
 * explicit ... ولا تعتمد على booleans مبعثرة"). A Mission always maps
 * 1:1 to an underlying tasks row (kind='runtime_plan') whose OWN status
 * ('pending'|'running'|'done'|'failed'|'cancelled') stays exactly as
 * every existing caller of taskManager.ts already expects — this enum is
 * strictly additive detail on top, read by mission-aware callers, never a
 * replacement the existing task-status contract has to know about.
 */
export type MissionState =
  | 'PLANNING' // objective received, plan not yet produced
  | 'RUNNING' // DAG executing
  | 'REPLANNING' // all tasks failed once; bounded re-plan in progress (see missionRunner.ts maxReplans)
  | 'AWAITING_APPROVAL' // HIGH_RISK tier — work finished, held for a human decision (see approvalGate.ts)
  | 'PAUSED' // Phase 3 Slice 13 (Warden PAUSE/RESUME) — a human explicitly halted execution; NEVER entered automatically. Deliberately excluded from resumeInterruptedMissions()'s startup auto-resume (see missionRepo.ts's interruptedMissionIds()) — a deliberate pause must survive a server restart without being silently resumed. Only Warden.resumeMission() (a real human decision) moves a mission out of PAUSED.
  | 'COMPLETED' // completion criteria met
  | 'FAILED' // exhausted retries/replans, or completion criteria not met
  | 'CANCELLED';

export const TERMINAL_MISSION_STATES: ReadonlySet<MissionState> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/**
 * v1 completion criteria — deliberately simple: a checkable struct, not a
 * rules engine. Documented as a first cut, not a false claim of a general
 * criteria language.
 */
export interface CompletionCriteria {
  /** Require every DAG task to have finished 'done' (no failed/skipped) — default true. */
  requireAllTasksDone?: boolean;
  /** Run the Evaluation/Correction/Verification hooks at all. Independent of requireVerificationOk below — you can ask verification to RUN (and be recorded in mission.result) without it being able to block completion. Defaults to true whenever requireVerificationOk is true, false otherwise. */
  runVerification?: boolean;
  /** Require Verifier.verify() to return verdict 'ok' on the final output before COMPLETED is allowed — default false. Implies runVerification. */
  requireVerificationOk?: boolean;
  /** Phase 3 (Warden): instead of blocking completion outright, hold the mission in AWAITING_APPROVAL for a human decision via the existing approvalGate.ts/POST /v2/approvals/:taskId/decide flow, whenever the FINAL verification pass (post-correction) still reports issues_found. Independent of requireVerificationOk — you can require human sign-off on issues without making unverifiable output an automatic FAILED. Implies runVerification. Default false (unchanged prior behavior: issues found post-correction just ship as-is). */
  requireApprovalOnIssues?: boolean;
  /** Minimum fraction (0-1) of DAG tasks that must be 'done' — default 1 (all). Lets a mission still COMPLETE on genuinely partial results when the caller explicitly accepts that. */
  minTaskSuccessRatio?: number;
}

export interface MissionFailureEntry {
  source: string; // e.g. 'dag' | 'planner' | 'verifier' | node id
  message: string;
  at: number;
}

export interface Mission {
  id: string;
  objective: string;
  state: MissionState;
  completionCriteria: CompletionCriteria;
  failures: MissionFailureEntry[];
  retryCount: number;
  replanCount: number;
  maxReplans: number;
  result: { finalOutput: string | null; evaluation?: unknown; verification?: unknown } | null;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface MissionStateTransition {
  missionId: string;
  seq: number;
  fromState: MissionState | null;
  toState: MissionState;
  reason: string | null;
  createdAt: number;
}
