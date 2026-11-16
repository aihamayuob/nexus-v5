import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface AgentCallLogEntry {
  agentId: string;
  success: boolean;
  latencyMs: number;
}

export interface AgentEvidenceRow {
  sampleSize: number;
  successCount: number;
  avgLatencyMs: number;
}

export class AgentCallLogRepo {
  constructor(private db: DatabaseSync) {}

  record(entry: AgentCallLogEntry): void {
    this.db
      .prepare('INSERT INTO agent_call_log (id, agent_id, success, latency_ms, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), entry.agentId, entry.success ? 1 : 0, entry.latencyMs, Date.now());
  }

  /** Same shape/intent as ProviderCallLogRepo.evidenceFor() — real aggregate evidence over the most recent `sampleSize` calls for this agent, nothing inferred or estimated. */
  evidenceFor(agentId: string, sampleSize = 50): AgentEvidenceRow {
    const rows = this.db
      .prepare('SELECT success, latency_ms FROM agent_call_log WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
      .all(agentId, sampleSize) as Array<{ success: number; latency_ms: number }>;
    if (rows.length === 0) return { sampleSize: 0, successCount: 0, avgLatencyMs: 0 };
    const successCount = rows.filter((r) => r.success === 1).length;
    const avgLatencyMs = rows.reduce((s, r) => s + r.latency_ms, 0) / rows.length;
    return { sampleSize: rows.length, successCount, avgLatencyMs };
  }
}
