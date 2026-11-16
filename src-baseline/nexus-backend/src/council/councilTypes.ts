/**
 * Council/Debate domain (Phase 3 §Council). Two modes, BOTH deliberate
 * server-side ports of the frontend's existing, field-tested modes — same
 * round structure, same synthesis contract — NOT new designs invented from
 * scratch. The frontend's client-side implementations are untouched
 * (additive-only); this gives the backend equivalent, durable, resumable,
 * HTTP-reachable versions built on the Slice 2 Agent Runtime.
 *
 * 'cross_exam' (Slice 1): one proposer, one critic, one rebuttal, one
 * supervisor synthesis — see runCrossExamination() in the frontend.
 *
 * 'situation_room' (Slice 4): N (2+) parallel specialists give independent
 * opinions (round 1) -> supervisor identifies tensions/gaps and drafts a
 * TARGETED follow-up question per specialist (JSON) -> each specialist
 * answers their own follow-up, seeing every round-1 opinion (round 2) ->
 * independent verification -> supervisor synthesis into one unified
 * report. See runSituationRoom() in the frontend for the exact pattern
 * being ported. Explicitly deferred from this port: the frontend's
 * optional humanitarian-veto review pass — a real, separate feature, not
 * bundled into this slice; see PHASE3_SLICE4_REPORT.md.
 *
 * Full N-agent Dynamic Swarm (agents generated/selected dynamically per
 * objective rather than named up front by the caller) remains deferred to
 * a later slice.
 */

export type CouncilMode = 'cross_exam' | 'situation_room';

export type CouncilState = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type CouncilRoundKind =
  | 'proposal'
  | 'critique'
  | 'rebuttal'
  | 'round1_opinion'
  | 'supervisor_analysis'
  | 'round2_followup'
  | 'humanitarian_veto'
  | 'verification'
  | 'synthesis';

export interface CouncilRound {
  sessionId: string;
  seq: number;
  kind: CouncilRoundKind;
  agentId: string | null; // null for the 'verification' round, which runs Verifier.verify() rather than an Agent
  content: string;
  providerUsed: string | null;
  modelUsed: string | null;
  createdAt: number;
}

export interface CouncilSession {
  id: string;
  mode: CouncilMode;
  topic: string;
  /** cross_exam only — null for situation_room sessions (see participantAgentIds instead). */
  proposerAgentId: string | null;
  /** cross_exam only — null for situation_room sessions. */
  criticAgentId: string | null;
  /** situation_room only — the N (2+) specialist agent ids, in the order they were given. Null for cross_exam sessions (see proposerAgentId/criticAgentId instead). */
  participantAgentIds: string[] | null;
  supervisorAgentId: string;
  state: CouncilState;
  finalOutput: string | null;
  verificationVerdict: 'ok' | 'issues_found' | 'unavailable' | null;
  verificationIssueCount: number | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  /** situation_room only — always false for cross_exam. Phase 3 Slice 15: persisted (migration 011) precisely so a resumed situation_room session knows for certain whether a humanitarian-veto review was ever requested, instead of a resume path having to guess and risk silently skipping a real safety review. */
  humanitarianVetoRequested: boolean;
}

export interface CreateCrossExamInput {
  mode?: 'cross_exam';
  topic: string;
  proposerAgentId: string;
  criticAgentId: string;
  supervisorAgentId?: string; // defaults to 'supervisor' (existing agent registry role — see agentRegistry.ts)
}

export interface CreateSituationRoomInput {
  mode: 'situation_room';
  topic: string;
  /** 2+ distinct, non-supervisor agent ids. */
  participantAgentIds: string[];
  supervisorAgentId?: string; // defaults to 'supervisor'
  /**
   * Slice 5b: a real server-side port of the frontend's optional
   * humanitarian-veto review pass (see runSituationRoom()'s
   * humanitarianVetoText handling). Off by default — opt-in, same as the
   * frontend's checkbox toggle. When true, a real 'humanitarian_aid' (or
   * 'conflict_resolution' as fallback — same precedence the frontend
   * uses) agent reviews both rounds and may flag items using the exact
   * "❌ مرفوض: <item> — السبب: <reason>" format; flagged items are (a)
   * logged to the ALREADY-EXISTING /api/audit/veto trail via
   * AuditRepo.logVeto() — real infrastructure that existed before this
   * slice but had no caller — and (b) mandatorily excluded from the
   * final synthesis via an instruction injected into the supervisor's
   * synthesis prompt, mirroring the frontend's exact wording.
   */
  humanitarianVeto?: boolean;
}

export type CreateCouncilSessionInput = CreateCrossExamInput | CreateSituationRoomInput;
