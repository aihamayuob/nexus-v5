import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface ScheduleRecurrence {
  type: 'daily' | 'interval' | 'once';
  hour?: number;
  minute?: number;
  everyMs?: number;
  at?: string;
}

export interface ScheduleRecord {
  id: string;
  goal: string;
  provider: string;
  model: string;
  recurrence: ScheduleRecurrence;
  enabled: boolean;
  lastRunAt: number | null;
  lastStatus: 'success' | 'error' | null;
  createdAt: number;
}

function rowToRecord(row: Record<string, unknown>): ScheduleRecord {
  return {
    id: row.id as string,
    goal: row.goal as string,
    provider: row.provider as string,
    model: row.model as string,
    recurrence: JSON.parse(row.recurrence_json as string),
    enabled: !!row.enabled,
    lastRunAt: (row.last_run_at as number) ?? null,
    lastStatus: (row.last_status as ScheduleRecord['lastStatus']) ?? null,
    createdAt: row.created_at as number,
  };
}

export class ScheduleRepo {
  constructor(private db: DatabaseSync) {}

  create(goal: string, provider: string, model: string, recurrence: ScheduleRecurrence): ScheduleRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO schedules (id, goal, provider, model, recurrence_json, enabled, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`
      )
      .run(id, goal, provider, model, JSON.stringify(recurrence), createdAt);
    return { id, goal, provider, model, recurrence, enabled: true, lastRunAt: null, lastStatus: null, createdAt };
  }

  list(): ScheduleRecord[] {
    const rows = this.db.prepare('SELECT * FROM schedules ORDER BY created_at DESC, rowid DESC').all() as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  get(id: string): ScheduleRecord | null {
    const row = this.db.prepare('SELECT * FROM schedules WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  setEnabled(id: string, enabled: boolean) {
    this.db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
  }

  recordRun(id: string, status: 'success' | 'error') {
    this.db.prepare('UPDATE schedules SET last_run_at = ?, last_status = ? WHERE id = ?').run(Date.now(), status, id);
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
  }
}
