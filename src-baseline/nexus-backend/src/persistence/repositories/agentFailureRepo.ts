import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface AgentFailureRecord {
  id: string;
  agentId: string;
  missionId: string | null;
  taskNodeId: string | null;
  provider: string | null;
  errorMessage: string;
  createdAt: number;
}

function rowToRecord(row: Record<string, unknown>): AgentFailureRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    missionId: (row.mission_id as string) ?? null,
    taskNodeId: (row.task_node_id as string) ?? null,
    provider: (row.provider as string) ?? null,
    errorMessage: row.error_message as string,
    createdAt: row.created_at as number,
  };
}

export class AgentFailureRepo {
  constructor(private db: DatabaseSync) {}

  record(f: { agentId: string; missionId?: string | null; taskNodeId?: string | null; provider?: string | null; errorMessage: string }): void {
    this.db
      .prepare(
        'INSERT INTO agent_failures (id, agent_id, mission_id, task_node_id, provider, error_message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(randomUUID(), f.agentId, f.missionId ?? null, f.taskNodeId ?? null, f.provider ?? null, f.errorMessage, Date.now());
  }

  /** Most recent failures for one agent — this IS AgentDefinition.failureHistory's dynamic backing store (see agentRegistry.ts's doc comment on why the static definition doesn't carry this itself). */
  recentForAgent(agentId: string, limit = 20): AgentFailureRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM agent_failures WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(agentId, limit) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  countForAgent(agentId: string, sinceMs?: number): number {
    const row = sinceMs
      ? (this.db.prepare('SELECT COUNT(*) AS c FROM agent_failures WHERE agent_id = ? AND created_at >= ?').get(agentId, sinceMs) as {
          c: number;
        })
      : (this.db.prepare('SELECT COUNT(*) AS c FROM agent_failures WHERE agent_id = ?').get(agentId) as { c: number });
    return row.c;
  }

  /**
   * Real deterministic aggregation across EVERY agent — no LLM call, no
   * guesswork, just a GROUP BY over data that's already been recorded by
   * every prior slice's failure paths (agentRunner.ts's catch block).
   * This is the data source for MetaCognition's repeated-failure-pattern
   * detection (Phase 3 §Meta-Cognition) — it never invents a pattern that
   * isn't a literal, countable fact in this table.
   */
  agentsWithFailuresSince(sinceMs: number, minCount: number): Array<{ agentId: string; count: number }> {
    const rows = this.db
      .prepare('SELECT agent_id AS agentId, COUNT(*) AS count FROM agent_failures WHERE created_at >= ? GROUP BY agent_id HAVING COUNT(*) >= ? ORDER BY count DESC')
      .all(sinceMs, minCount) as Array<{ agentId: string; count: number }>;
    return rows;
  }
}
