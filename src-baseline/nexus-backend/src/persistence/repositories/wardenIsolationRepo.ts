import type { DatabaseSync } from 'node:sqlite';

export interface AgentIsolationRecord {
  agentId: string;
  reason: string;
  isolatedAt: number;
}

function rowToRecord(row: Record<string, unknown>): AgentIsolationRecord {
  return {
    agentId: row.agent_id as string,
    reason: row.reason as string,
    isolatedAt: row.isolated_at as number,
  };
}

/**
 * Phase 3 Slice 13 (Warden ISOLATE) — durable per-agent block list.
 *
 * Deliberately just a repo, with NO service layer of its own that
 * agentRunner.ts would have to import: agents/agentRunner.ts reads this
 * repo DIRECTLY (getRepos().wardenIsolation.isIsolated(agentId)) at the
 * very first line of runAgentTask(), rather than importing warden.ts and
 * calling something like Warden.isIsolated(). That matters for a real,
 * verified reason: warden.ts already imports council/councilRunner.ts
 * (for cancelCouncilSession/getCouncilSession), and councilRunner.ts
 * imports agents/agentRunner.ts — so agentRunner.ts importing warden.ts
 * back would be a genuine circular import (warden -> councilRunner ->
 * agentRunner -> warden). Both Warden.isolateAgent()/deisolateAgent() (in
 * warden.ts) and runAgentTask()'s enforcement check (in agentRunner.ts)
 * instead read/write this same repo directly, so the two sides of the
 * feature share one source of truth without either module importing the
 * other.
 */
export class WardenIsolationRepo {
  constructor(private db: DatabaseSync) {}

  isolate(agentId: string, reason: string): AgentIsolationRecord {
    const isolatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO warden_agent_isolation (agent_id, reason, isolated_at) VALUES (?, ?, ?)
         ON CONFLICT(agent_id) DO UPDATE SET reason = excluded.reason, isolated_at = excluded.isolated_at`
      )
      .run(agentId, reason, isolatedAt);
    return { agentId, reason, isolatedAt };
  }

  /** Returns true iff a row actually existed and was removed — lets callers distinguish "really isolated, now cleared" from "was never isolated". */
  deisolate(agentId: string): boolean {
    const result = this.db.prepare('DELETE FROM warden_agent_isolation WHERE agent_id = ?').run(agentId);
    return Number(result.changes ?? 0) > 0;
  }

  isIsolated(agentId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM warden_agent_isolation WHERE agent_id = ?').get(agentId);
    return !!row;
  }

  get(agentId: string): AgentIsolationRecord | null {
    const row = this.db.prepare('SELECT * FROM warden_agent_isolation WHERE agent_id = ?').get(agentId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(): AgentIsolationRecord[] {
    const rows = this.db.prepare('SELECT * FROM warden_agent_isolation ORDER BY isolated_at DESC').all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }
}
