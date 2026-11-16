import type { DatabaseSync } from 'node:sqlite';
import type { Mission, MissionState, CompletionCriteria, MissionFailureEntry, MissionStateTransition } from '../../orchestrator/missionTypes.js';

function rowToMission(row: Record<string, unknown>): Mission {
  return {
    id: row.id as string,
    objective: row.objective as string,
    state: row.state as MissionState,
    completionCriteria: JSON.parse(row.completion_criteria_json as string) as CompletionCriteria,
    failures: JSON.parse(row.failures_json as string) as MissionFailureEntry[],
    retryCount: row.retry_count as number,
    replanCount: row.replan_count as number,
    maxReplans: row.max_replans as number,
    result: row.result_json ? (JSON.parse(row.result_json as string) as Mission['result']) : null,
    metadata: JSON.parse(row.metadata_json as string) as Record<string, unknown>,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    startedAt: (row.started_at as number) ?? null,
    completedAt: (row.completed_at as number) ?? null,
  };
}

export class MissionRepo {
  constructor(private db: DatabaseSync) {}

  create(m: {
    id: string;
    objective: string;
    completionCriteria: CompletionCriteria;
    maxReplans: number;
    metadata: Record<string, unknown>;
  }): Mission {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO missions (id, objective, state, completion_criteria_json, failures_json, retry_count, replan_count, max_replans, result_json, metadata_json, created_at, updated_at, started_at, completed_at)
         VALUES (?, ?, 'PLANNING', ?, '[]', 0, 0, ?, NULL, ?, ?, ?, NULL, NULL)`
      )
      .run(m.id, m.objective, JSON.stringify(m.completionCriteria), m.maxReplans, JSON.stringify(m.metadata), now, now);
    this.recordTransition(m.id, null, 'PLANNING', 'تم إنشاء المهمة (Mission).');
    return this.get(m.id)!;
  }

  get(id: string): Mission | null {
    const row = this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToMission(row) : null;
  }

  /** Every state change goes through here — updates missions.state AND appends the audit row in the SAME call, so the two can never drift apart. */
  transition(id: string, to: MissionState, reason?: string): void {
    const current = this.get(id);
    const now = Date.now();
    const startedAt = current?.startedAt ?? (to === 'RUNNING' ? now : null);
    const completedAt = to === 'COMPLETED' || to === 'FAILED' || to === 'CANCELLED' ? now : (current?.completedAt ?? null);
    this.db
      .prepare('UPDATE missions SET state = ?, updated_at = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE id = ?')
      .run(to, now, startedAt, completedAt, id);
    this.recordTransition(id, current?.state ?? null, to, reason ?? null);
  }

  private recordTransition(missionId: string, from: MissionState | null, to: MissionState, reason: string | null) {
    const seqRow = this.db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM mission_state_transitions WHERE mission_id = ?').get(missionId) as {
      next: number;
    };
    this.db
      .prepare('INSERT INTO mission_state_transitions (mission_id, seq, from_state, to_state, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(missionId, seqRow.next, from, to, reason, Date.now());
  }

  transitions(missionId: string): MissionStateTransition[] {
    const rows = this.db
      .prepare('SELECT * FROM mission_state_transitions WHERE mission_id = ? ORDER BY seq ASC')
      .all(missionId) as Record<string, unknown>[];
    return rows.map((r) => ({
      missionId: r.mission_id as string,
      seq: r.seq as number,
      fromState: (r.from_state as MissionState) ?? null,
      toState: r.to_state as MissionState,
      reason: (r.reason as string) ?? null,
      createdAt: r.created_at as number,
    }));
  }

  appendFailure(id: string, entry: MissionFailureEntry): void {
    const m = this.get(id);
    if (!m) return;
    const failures = [...m.failures, entry];
    this.db.prepare('UPDATE missions SET failures_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(failures), Date.now(), id);
  }

  incrementReplanCount(id: string): number {
    this.db.prepare('UPDATE missions SET replan_count = replan_count + 1, updated_at = ? WHERE id = ?').run(Date.now(), id);
    return this.get(id)!.replanCount;
  }

  setRetryCount(id: string, retryCount: number): void {
    this.db.prepare('UPDATE missions SET retry_count = ?, updated_at = ? WHERE id = ?').run(retryCount, Date.now(), id);
  }

  setResult(id: string, result: Mission['result']): void {
    this.db.prepare('UPDATE missions SET result_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(result), Date.now(), id);
  }

  /** Missions left non-terminal by an unclean shutdown — same resumability contract as ExecutionCheckpoint.resumablePlanTaskIds(), scoped to the mission layer. Used by Warden.status()'s "activeMissions" operational count, where a deliberately PAUSED mission is still correctly "active" (it still holds a place in the system and a human is expected to act on it) — for THAT purpose it stays included, unlike interruptedMissionIds() below. */
  resumableMissionIds(): string[] {
    const rows = this.db
      .prepare("SELECT id FROM missions WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED')")
      .all() as Record<string, unknown>[];
    return rows.map((r) => r.id as string);
  }

  /**
   * Phase 3 Slice 13 (Warden PAUSE/RESUME) — the set missionRunner.ts's
   * resumeInterruptedMissions() actually iterates at startup. Identical to
   * resumableMissionIds() EXCEPT it also excludes 'PAUSED': a PAUSED
   * mission was stopped on purpose by a human via Warden.pauseMission(),
   * and must survive a server restart still PAUSED — only a later, real
   * Warden.resumeMission() call may resume it. Silently auto-resuming a
   * deliberately paused mission on the next process start would defeat
   * the entire point of PAUSE.
   */
  interruptedMissionIds(): string[] {
    const rows = this.db
      .prepare("SELECT id FROM missions WHERE state NOT IN ('COMPLETED','FAILED','CANCELLED','PAUSED')")
      .all() as Record<string, unknown>[];
    return rows.map((r) => r.id as string);
  }
}
