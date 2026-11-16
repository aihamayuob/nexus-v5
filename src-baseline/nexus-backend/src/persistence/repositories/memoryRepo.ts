import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type MemoryKind = 'knowledge' | 'episodic' | 'semantic';

export interface MemoryItem {
  id: string;
  projectId: string | null;
  userId: string | null;
  kind: MemoryKind;
  title: string | null;
  content: string;
  embedding: number[] | null;
  createdAt: number;
}

function rowToItem(row: Record<string, unknown>): MemoryItem {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    userId: (row.user_id as string) ?? null,
    kind: row.kind as MemoryKind,
    title: (row.title as string) ?? null,
    content: row.content as string,
    embedding: row.embedding_json ? JSON.parse(row.embedding_json as string) : null,
    createdAt: row.created_at as number,
  };
}

/**
 * Foundational repository for hosting persistent semantic memory /
 * knowledge server-side, so a large knowledge base doesn't have to be
 * fully downloaded into the browser on every load. Retrieval (embedding
 * similarity / keyword fallback) lives in memory/contextFabric.ts — this
 * repository is deliberately just storage + simple filtering.
 */
export class MemoryRepo {
  constructor(private db: DatabaseSync) {}

  add(item: Omit<MemoryItem, 'id' | 'createdAt'>): MemoryItem {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO memory_items (id, project_id, user_id, kind, title, content, embedding_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, item.projectId, item.userId, item.kind, item.title, item.content, item.embedding ? JSON.stringify(item.embedding) : null, createdAt);
    return { ...item, id, createdAt };
  }

  /** Knowledge Freshness Engine — the one caller that needs a single memory item by id rather than a project-scoped list. */
  get(id: string): MemoryItem | null {
    const row = this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToItem(row) : null;
  }

  setEmbedding(id: string, embedding: number[]) {
    this.db.prepare('UPDATE memory_items SET embedding_json = ? WHERE id = ?').run(JSON.stringify(embedding), id);
  }

  listForProject(projectId: string | null, kind?: MemoryKind, limit = 200): MemoryItem[] {
    const rows = kind
      ? (this.db
          .prepare('SELECT * FROM memory_items WHERE (project_id IS ? OR project_id = ?) AND kind = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(projectId, projectId, kind, limit) as Record<string, unknown>[])
      : (this.db
          .prepare('SELECT * FROM memory_items WHERE project_id IS ? OR project_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?')
          .all(projectId, projectId, limit) as Record<string, unknown>[]);
    return rows.map(rowToItem);
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
  }
}
