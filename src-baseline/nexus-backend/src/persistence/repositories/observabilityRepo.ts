import type { DatabaseSync } from 'node:sqlite';

export interface ObservabilityRecord {
  taskId: string;
  route: string;
  agents: string[];
  models: { provider: string; model: string }[];
  tools: string[];
  latencyMs: number;
  retries: number;
  failures: { message: string; at: number }[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  verification: { ran: boolean; verdict?: string; issueCount?: number } | null;
  finalStatus: 'ok' | 'failed' | 'cancelled';
  createdAt: number;
}

function rowToRecord(row: Record<string, unknown>): ObservabilityRecord {
  return {
    taskId: row.task_id as string,
    route: row.route as string,
    agents: JSON.parse((row.agents_json as string) || '[]'),
    models: JSON.parse((row.models_json as string) || '[]'),
    tools: JSON.parse((row.tools_json as string) || '[]'),
    latencyMs: row.latency_ms as number,
    retries: row.retries as number,
    failures: JSON.parse((row.failures_json as string) || '[]'),
    inputTokens: row.input_tokens as number,
    outputTokens: row.output_tokens as number,
    costUsd: row.cost_usd as number,
    verification: row.verification_json ? JSON.parse(row.verification_json as string) : null,
    finalStatus: row.final_status as ObservabilityRecord['finalStatus'],
    createdAt: row.created_at as number,
  };
}

export class ObservabilityRepo {
  constructor(private db: DatabaseSync) {}

  upsert(rec: ObservabilityRecord) {
    this.db
      .prepare(
        `INSERT INTO observability_events
           (task_id, route, agents_json, models_json, tools_json, latency_ms, retries, failures_json, input_tokens, output_tokens, cost_usd, verification_json, final_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           route=excluded.route, agents_json=excluded.agents_json, models_json=excluded.models_json,
           tools_json=excluded.tools_json, latency_ms=excluded.latency_ms, retries=excluded.retries,
           failures_json=excluded.failures_json, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
           cost_usd=excluded.cost_usd, verification_json=excluded.verification_json, final_status=excluded.final_status`
      )
      .run(
        rec.taskId,
        rec.route,
        JSON.stringify(rec.agents),
        JSON.stringify(rec.models),
        JSON.stringify(rec.tools),
        rec.latencyMs,
        rec.retries,
        JSON.stringify(rec.failures),
        rec.inputTokens,
        rec.outputTokens,
        rec.costUsd,
        rec.verification ? JSON.stringify(rec.verification) : null,
        rec.finalStatus,
        rec.createdAt
      );
  }

  recent(limit = 50, route?: string): ObservabilityRecord[] {
    const rows = route
      ? (this.db
          .prepare('SELECT * FROM observability_events WHERE route = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(route, limit) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM observability_events ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Record<
          string,
          unknown
        >[]);
    return rows.map(rowToRecord);
  }

  /** Sum of cost_usd within the last windowMs — used by the budget guard. */
  costInWindow(windowMs: number): number {
    const since = Date.now() - windowMs;
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd),0) as s FROM observability_events WHERE created_at >= ?').get(
      since
    ) as Record<string, unknown>;
    return (row.s as number) ?? 0;
  }

  aggregate(limit = 100) {
    const recs = this.recent(limit);
    const totalCost = recs.reduce((s, r) => s + r.costUsd, 0);
    const totalRetries = recs.reduce((s, r) => s + r.retries, 0);
    const failed = recs.filter((r) => r.finalStatus === 'failed').length;
    const verified = recs.filter((r) => r.verification?.ran);
    return {
      sampleSize: recs.length,
      totalCostUsd: totalCost,
      avgLatencyMs: recs.length ? recs.reduce((s, r) => s + r.latencyMs, 0) / recs.length : 0,
      totalRetries,
      failureRate: recs.length ? failed / recs.length : 0,
      verification: {
        ran: verified.length,
        okCount: verified.filter((r) => r.verification?.verdict === 'ok').length,
      },
    };
  }

  /** Bounds unlimited growth over a long-running deployment — old task-level records beyond this window are dropped. Aggregate history (benchmark_runs, if the operator runs periodic evaluations) survives independently of this. */
  pruneOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare('DELETE FROM observability_events WHERE created_at < ?').run(cutoff);
    return Number(result.changes ?? 0);
  }
}
