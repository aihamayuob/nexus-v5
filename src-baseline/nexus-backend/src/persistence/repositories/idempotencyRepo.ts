import type { DatabaseSync } from 'node:sqlite';

export class IdempotencyRepo {
  constructor(private db: DatabaseSync) {}

  /** Returns the existing task id for this key, if any request with this key already started a task. */
  find(key: string): string | null {
    const row = this.db.prepare('SELECT task_id FROM idempotency_keys WHERE key = ?').get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? (row.task_id as string) : null;
  }

  /** Atomically claims a key for a new task id — returns false if another request already claimed it first (race-safe via PRIMARY KEY conflict). */
  claim(key: string, taskId: string): boolean {
    try {
      this.db.prepare('INSERT INTO idempotency_keys (key, task_id, created_at) VALUES (?, ?, ?)').run(key, taskId, Date.now());
      return true;
    } catch {
      return false; // PRIMARY KEY collision — someone else claimed it concurrently
    }
  }
}
