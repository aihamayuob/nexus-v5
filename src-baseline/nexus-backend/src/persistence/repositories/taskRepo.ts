import type { DatabaseSync } from 'node:sqlite';

export type TaskKind = 'chat' | 'runtime_plan';
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  status: TaskStatus;
  idempotencyKey: string | null;
  provider: string | null;
  model: string | null;
  goalOrPromptLen: number | null;
  projectId: string | null;
  userId: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  errorMessage: string | null;
}

function rowToRecord(row: Record<string, unknown>): TaskRecord {
  return {
    id: row.id as string,
    kind: row.kind as TaskKind,
    status: row.status as TaskStatus,
    idempotencyKey: (row.idempotency_key as string) ?? null,
    provider: (row.provider as string) ?? null,
    model: (row.model as string) ?? null,
    goalOrPromptLen: (row.goal_or_prompt_len as number) ?? null,
    projectId: (row.project_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    finishedAt: (row.finished_at as number) ?? null,
    errorMessage: (row.error_message as string) ?? null,
  };
}

export class TaskRepo {
  constructor(private db: DatabaseSync) {}

  create(t: Omit<TaskRecord, 'createdAt' | 'updatedAt' | 'finishedAt' | 'status'> & { status?: TaskStatus }): TaskRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tasks (id, kind, status, idempotency_key, provider, model, goal_or_prompt_len, project_id, user_id, created_at, updated_at, finished_at, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        t.id,
        t.kind,
        t.status ?? 'pending',
        t.idempotencyKey,
        t.provider,
        t.model,
        t.goalOrPromptLen,
        t.projectId,
        t.userId,
        now,
        now
      );
    return this.get(t.id)!;
  }

  get(id: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  findByIdempotencyKey(key: string): TaskRecord | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE idempotency_key = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  updateStatus(id: string, status: TaskStatus, errorMessage?: string) {
    const now = Date.now();
    const finishedAt = status === 'done' || status === 'failed' || status === 'cancelled' ? now : null;
    this.db
      .prepare('UPDATE tasks SET status = ?, updated_at = ?, finished_at = COALESCE(?, finished_at), error_message = ? WHERE id = ?')
      .run(status, now, finishedAt, errorMessage ?? null, id);
  }

  /** F-04: the task row is created (claimTask) with the REQUESTED provider/model, before routing. After a fallback the provider that actually answered differs, so the serving pair is recorded here once a completion succeeds. */
  recordServed(id: string, provider: string, model: string) {
    this.db.prepare('UPDATE tasks SET provider = ?, model = ?, updated_at = ? WHERE id = ?').run(provider, model, Date.now(), id);
  }

  recent(limit = 50): TaskRecord[] {
    const rows = this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }
}
