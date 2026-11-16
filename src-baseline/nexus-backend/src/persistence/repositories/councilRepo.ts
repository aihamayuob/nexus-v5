import type { DatabaseSync } from 'node:sqlite';
import type { CouncilSession, CouncilState, CouncilRound, CouncilRoundKind, CouncilMode } from '../../council/councilTypes.js';

function rowToSession(row: Record<string, unknown>): CouncilSession {
  return {
    id: row.id as string,
    mode: row.mode as CouncilMode,
    topic: row.topic as string,
    proposerAgentId: (row.proposer_agent_id as string) ?? null,
    criticAgentId: (row.critic_agent_id as string) ?? null,
    participantAgentIds: row.specialist_agent_ids_json ? (JSON.parse(row.specialist_agent_ids_json as string) as string[]) : null,
    supervisorAgentId: row.supervisor_agent_id as string,
    state: row.state as CouncilState,
    finalOutput: (row.final_output as string) ?? null,
    verificationVerdict: (row.verification_verdict as CouncilSession['verificationVerdict']) ?? null,
    verificationIssueCount: (row.verification_issue_count as number) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    completedAt: (row.completed_at as number) ?? null,
    humanitarianVetoRequested: (row.humanitarian_veto_requested as number) === 1,
  };
}

export interface CreateCouncilSessionRow {
  id: string;
  mode: CouncilMode;
  topic: string;
  supervisorAgentId: string;
  /** cross_exam */
  proposerAgentId?: string;
  criticAgentId?: string;
  /** situation_room */
  participantAgentIds?: string[];
  /** situation_room — Phase 3 Slice 15: persisted (migration 011) so resumeInterruptedCouncilSessions() never has to guess whether a humanitarian-veto review was requested for an interrupted session. Always false/absent for cross_exam. */
  humanitarianVeto?: boolean;
}

export class CouncilRepo {
  constructor(private db: DatabaseSync) {}

  create(s: CreateCouncilSessionRow): CouncilSession {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO council_sessions (id, mode, topic, proposer_agent_id, critic_agent_id, supervisor_agent_id, specialist_agent_ids_json, state, final_output, verification_verdict, verification_issue_count, error_message, created_at, updated_at, completed_at, humanitarian_veto_requested)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'RUNNING', NULL, NULL, NULL, NULL, ?, ?, NULL, ?)`
      )
      .run(
        s.id,
        s.mode,
        s.topic,
        s.proposerAgentId ?? null,
        s.criticAgentId ?? null,
        s.supervisorAgentId,
        s.participantAgentIds ? JSON.stringify(s.participantAgentIds) : null,
        now,
        now,
        s.humanitarianVeto === true ? 1 : 0
      );
    return this.get(s.id)!;
  }

  get(id: string): CouncilSession | null {
    const row = this.db.prepare('SELECT * FROM council_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }

  appendRound(sessionId: string, kind: CouncilRoundKind, agentId: string | null, content: string, providerUsed: string | null, modelUsed: string | null): void {
    const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM council_rounds WHERE session_id = ?').get(sessionId) as { next: number };
    this.db
      .prepare('INSERT INTO council_rounds (session_id, seq, kind, agent_id, content, provider_used, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(sessionId, seqRow.next, kind, agentId, content, providerUsed, modelUsed, Date.now());
  }

  rounds(sessionId: string): CouncilRound[] {
    const rows = this.db.prepare('SELECT * FROM council_rounds WHERE session_id = ? ORDER BY seq ASC').all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      sessionId: r.session_id as string,
      seq: r.seq as number,
      kind: r.kind as CouncilRoundKind,
      agentId: (r.agent_id as string) ?? null,
      content: r.content as string,
      providerUsed: (r.provider_used as string) ?? null,
      modelUsed: (r.model_used as string) ?? null,
      createdAt: r.created_at as number,
    }));
  }

  complete(id: string, finalOutput: string, verdict: CouncilSession['verificationVerdict'], issueCount: number | null): void {
    const now = Date.now();
    this.db
      .prepare("UPDATE council_sessions SET state = 'COMPLETED', final_output = ?, verification_verdict = ?, verification_issue_count = ?, updated_at = ?, completed_at = ? WHERE id = ?")
      .run(finalOutput, verdict, issueCount, now, now, id);
  }

  fail(id: string, errorMessage: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE council_sessions SET state = 'FAILED', error_message = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(errorMessage, now, now, id);
  }

  /**
   * Phase 3 Slice 14 (Council/Swarm resume) — sessions left RUNNING by an
   * unclean shutdown. Council-layer counterpart to missionRepo.ts's
   * interruptedMissionIds(), but returns full session rows (not just ids):
   * resuming a council session needs its original participants/topic
   * reconstructed from the row itself, unlike a mission (which re-plans
   * fresh from its stored objective alone via planForMission()).
   */
  interruptedSessions(): CouncilSession[] {
    const rows = this.db.prepare("SELECT * FROM council_sessions WHERE state = 'RUNNING'").all() as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  /** Controlled Fine-Tuning — real, quality-gated training examples: completed cross_exam sessions where THIS agent was the proposer (the content is genuinely theirs, not mixed with the supervisor's synthesis voice) AND independent verification found no issues. Deliberately does not include situation_room (no single "proposer" role there) or any session with a non-'ok' verdict — an unverified or issue-flagged output must never become fine-tuning material. */
  listVerifiedProposalsByAgent(proposerAgentId: string): CouncilSession[] {
    const rows = this.db
      .prepare("SELECT * FROM council_sessions WHERE mode = 'cross_exam' AND proposer_agent_id = ? AND state = 'COMPLETED' AND verification_verdict = 'ok' ORDER BY completed_at DESC")
      .all(proposerAgentId) as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  /** Non-terminal session count — same "not in a terminal state" definition missionRepo.ts's resumableMissionIds() uses, for Warden.status()'s operational snapshot. */
  activeCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS c FROM council_sessions WHERE state = 'RUNNING'").get() as { c: number };
    return row.c;
  }
}
