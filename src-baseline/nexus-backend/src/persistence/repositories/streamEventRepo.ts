import type { DatabaseSync } from 'node:sqlite';

export interface StoredEvent {
  seq: number;
  event: string;
  data: unknown;
}

export class StreamEventRepo {
  constructor(private db: DatabaseSync) {}

  append(taskId: string, seq: number, event: string, data: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO stream_events (task_id, seq, event, data_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, seq, event, JSON.stringify(data), Date.now());
  }

  since(taskId: string, afterSeq: number): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT seq, event, data_json FROM stream_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC')
      .all(taskId, afterSeq) as Record<string, unknown>[];
    return rows.map((r) => ({ seq: r.seq as number, event: r.event as string, data: JSON.parse(r.data_json as string) }));
  }

  maxSeq(taskId: string): number {
    const row = this.db.prepare('SELECT MAX(seq) as m FROM stream_events WHERE task_id = ?').get(taskId) as
      | Record<string, unknown>
      | undefined;
    return (row?.m as number) ?? 0;
  }

  /** Housekeeping — old finished streams don't need to keep their full event log forever. */
  prune(taskId: string) {
    this.db.prepare('DELETE FROM stream_events WHERE task_id = ?').run(taskId);
  }

  /** Bulk housekeeping — deletes stream events for any task that reached a terminal state more than maxAgeMs ago. Keeps a grace window so a client that comes back to resume/inspect a just-finished task shortly after can still do so. */
  pruneFinishedOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db
      .prepare(
        `DELETE FROM stream_events WHERE task_id IN (
           SELECT id FROM tasks WHERE status IN ('done','failed','cancelled') AND finished_at IS NOT NULL AND finished_at < ?
         )`
      )
      .run(cutoff);
    return Number(result.changes ?? 0);
  }
}
