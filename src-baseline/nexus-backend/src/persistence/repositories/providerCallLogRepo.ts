import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface ProviderCallLogEntry {
  taskId: string | null;
  provider: string;
  model: string | null;
  route: string | null;
  success: boolean;
  latencyMs: number;
  costUsd: number;
  errorMessage: string | null;
}

export interface ProviderEvidenceRow {
  sampleSize: number;
  successCount: number;
  avgLatencyMs: number;
  avgCostUsd: number;
  recentFailureReasons: string[];
}

export class ProviderCallLogRepo {
  constructor(private db: DatabaseSync) {}

  record(entry: ProviderCallLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO provider_call_log (id, task_id, provider, model, route, success, latency_ms, cost_usd, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        entry.taskId,
        entry.provider,
        entry.model,
        entry.route,
        entry.success ? 1 : 0,
        entry.latencyMs,
        entry.costUsd,
        entry.errorMessage,
        Date.now()
      );
  }

  /** Aggregate evidence for one provider, optionally scoped to a route ("task type"), over the last `sampleSize` calls. */
  evidenceFor(provider: string, opts: { route?: string; sampleSize?: number } = {}): ProviderEvidenceRow {
    const limit = opts.sampleSize ?? 50;
    const rows = (
      opts.route
        ? this.db
            .prepare('SELECT * FROM provider_call_log WHERE provider = ? AND route = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
            .all(provider, opts.route, limit)
        : this.db.prepare('SELECT * FROM provider_call_log WHERE provider = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(provider, limit)
    ) as Record<string, unknown>[];

    if (rows.length === 0) return { sampleSize: 0, successCount: 0, avgLatencyMs: 0, avgCostUsd: 0, recentFailureReasons: [] };

    const successCount = rows.filter((r) => r.success === 1).length;
    const avgLatencyMs = rows.reduce((s, r) => s + (r.latency_ms as number), 0) / rows.length;
    const avgCostUsd = rows.reduce((s, r) => s + (r.cost_usd as number), 0) / rows.length;
    const recentFailureReasons = rows
      .filter((r) => r.success === 0 && r.error_message)
      .slice(0, 5)
      .map((r) => r.error_message as string);

    return { sampleSize: rows.length, successCount, avgLatencyMs, avgCostUsd, recentFailureReasons };
  }

  /** Housekeeping — bounds unlimited growth of this table over a long-running deployment. */
  pruneOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare('DELETE FROM provider_call_log WHERE created_at < ?').run(cutoff);
    return Number(result.changes ?? 0);
  }
}
