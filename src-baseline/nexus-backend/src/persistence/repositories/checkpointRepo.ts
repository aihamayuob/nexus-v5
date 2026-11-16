import type { DatabaseSync } from 'node:sqlite';

export interface DagNodeRecord {
  taskId: string;
  nodeId: string;
  description: string | null;
  dependsOn: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  attempt: number;
  output: string | null;
  errorMessage: string | null;
  updatedAt: number;
}

function rowToNode(row: Record<string, unknown>): DagNodeRecord {
  return {
    taskId: row.task_id as string,
    nodeId: row.node_id as string,
    description: (row.description as string) ?? null,
    dependsOn: JSON.parse((row.depends_on_json as string) || '[]'),
    status: row.status as DagNodeRecord['status'],
    attempt: row.attempt as number,
    output: (row.output as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    updatedAt: row.updated_at as number,
  };
}

export class CheckpointRepo {
  constructor(private db: DatabaseSync) {}

  saveCheckpoint(taskId: string, phase: string, state: unknown) {
    this.db
      .prepare(
        `INSERT INTO checkpoints (task_id, phase, state_json, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id, phase) DO UPDATE SET state_json = excluded.state_json, created_at = excluded.created_at`
      )
      .run(taskId, phase, JSON.stringify(state), Date.now());
  }

  latestCheckpoint(taskId: string): { phase: string; state: unknown } | null {
    const row = this.db
      .prepare('SELECT phase, state_json FROM checkpoints WHERE task_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
      .get(taskId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return { phase: row.phase as string, state: JSON.parse(row.state_json as string) };
  }

  clearTask(taskId: string) {
    this.db.prepare('DELETE FROM checkpoints WHERE task_id = ?').run(taskId);
  }

  upsertNode(node: Omit<DagNodeRecord, 'updatedAt'>) {
    this.db
      .prepare(
        `INSERT INTO dag_nodes (task_id, node_id, description, depends_on_json, status, attempt, output, error_message, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id, node_id) DO UPDATE SET
           description = excluded.description, depends_on_json = excluded.depends_on_json,
           status = excluded.status, attempt = excluded.attempt, output = excluded.output,
           error_message = excluded.error_message, updated_at = excluded.updated_at`
      )
      .run(
        node.taskId,
        node.nodeId,
        node.description,
        JSON.stringify(node.dependsOn),
        node.status,
        node.attempt,
        node.output,
        node.errorMessage,
        Date.now()
      );
  }

  nodesForTask(taskId: string): DagNodeRecord[] {
    const rows = this.db.prepare('SELECT * FROM dag_nodes WHERE task_id = ?').all(taskId) as Record<string, unknown>[];
    return rows.map(rowToNode);
  }

  /** Resumable plans: any plan-kind task that isn't in a terminal state. */
  resumablePlanTaskIds(): string[] {
    const rows = this.db
      .prepare("SELECT id FROM tasks WHERE kind = 'runtime_plan' AND status IN ('pending','running')")
      .all() as Record<string, unknown>[];
    return rows.map((r) => r.id as string);
  }
}
