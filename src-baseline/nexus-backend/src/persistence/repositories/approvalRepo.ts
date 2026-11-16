import type { DatabaseSync } from 'node:sqlite';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRecord {
  taskId: string;
  status: ApprovalStatus;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
}

function rowToRecord(row: Record<string, unknown>): ApprovalRecord {
  return {
    taskId: row.task_id as string,
    status: row.status as ApprovalStatus,
    reason: (row.reason as string) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
    decidedAt: (row.decided_at as number) ?? null,
    createdAt: row.created_at as number,
  };
}

export class ApprovalRepo {
  constructor(private db: DatabaseSync) {}

  create(taskId: string, reason: string): ApprovalRecord {
    const createdAt = Date.now();
    this.db
      .prepare('INSERT INTO approvals (task_id, status, reason, created_at) VALUES (?, ?, ?, ?)')
      .run(taskId, 'pending', reason, createdAt);
    return { taskId, status: 'pending', reason, decidedBy: null, decidedAt: null, createdAt };
  }

  get(taskId: string): ApprovalRecord | null {
    const row = this.db.prepare('SELECT * FROM approvals WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  decide(taskId: string, status: 'approved' | 'rejected', decidedBy: string | null): void {
    this.db
      .prepare('UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE task_id = ?')
      .run(status, decidedBy, Date.now(), taskId);
  }

  pending(limit = 50): ApprovalRecord[] {
    const rows = this.db.prepare("SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?").all(
      limit
    ) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }
}
