import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type FeedbackRating = 'up' | 'down';

export interface FeedbackEntry {
  id: string;
  taskId: string;
  rating: FeedbackRating;
  note: string | null;
  createdAt: number;
}

export class FeedbackRepo {
  constructor(private db: DatabaseSync) {}

  record(taskId: string, rating: FeedbackRating, note: string | null): FeedbackEntry {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare('INSERT INTO feedback (id, task_id, rating, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, taskId, rating, note, createdAt);
    return { id, taskId, rating, note, createdAt };
  }

  forTask(taskId: string): FeedbackEntry[] {
    const rows = this.db.prepare('SELECT * FROM feedback WHERE task_id = ? ORDER BY created_at DESC, rowid DESC').all(taskId) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      rating: r.rating as FeedbackRating,
      note: (r.note as string) ?? null,
      createdAt: r.created_at as number,
    }));
  }

  /** Aggregate score in [-1, 1] over recent feedback for a route, used as one AdaptiveModelRouter evidence dimension. Returns null if there's no feedback at all (never fabricate a neutral score from zero data). */
  recentScoreForRoute(route: string, limit = 100): number | null {
    const rows = this.db
      .prepare(
        `SELECT f.rating FROM feedback f
         JOIN observability_events o ON o.task_id = f.task_id
         WHERE o.route = ?
         ORDER BY f.created_at DESC LIMIT ?`
      )
      .all(route, limit) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const up = rows.filter((r) => r.rating === 'up').length;
    const down = rows.filter((r) => r.rating === 'down').length;
    return (up - down) / rows.length;
  }
}
