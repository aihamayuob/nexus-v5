import type { DatabaseSync } from 'node:sqlite';

export class A2aTaskRepo {
  constructor(private db: DatabaseSync) {}

  /** Idempotent: a retried SendMessage with the same message id re-uses the existing row. */
  claim(taskId: string, owner: string): void {
    this.db.prepare('INSERT OR IGNORE INTO a2a_tasks (task_id, owner, created_at) VALUES (?, ?, ?)').run(taskId, owner, Date.now());
  }

  get(taskId: string): { taskId: string; owner: string; createdAt: number } | null {
    const r = this.db.prepare('SELECT * FROM a2a_tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
    return r ? { taskId: r.task_id as string, owner: r.owner as string, createdAt: r.created_at as number } : null;
  }
}
