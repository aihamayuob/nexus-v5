import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ConsolidationStatus = 'open' | 'merged' | 'dismissed';

export interface ConsolidationCandidate {
  id: string;
  projectId: string | null;
  kind: string;
  itemIdA: string;
  itemIdB: string;
  similarity: number;
  status: ConsolidationStatus;
  mergedItemId: string | null;
  createdAt: number;
  decidedAt: number | null;
}

function rowToCandidate(row: Record<string, unknown>): ConsolidationCandidate {
  return {
    id: row.id as string,
    projectId: (row.project_id as string) ?? null,
    kind: row.kind as string,
    itemIdA: row.item_id_a as string,
    itemIdB: row.item_id_b as string,
    similarity: row.similarity as number,
    status: row.status as ConsolidationStatus,
    mergedItemId: (row.merged_item_id as string) ?? null,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number) ?? null,
  };
}

export class MemoryConsolidationRepo {
  constructor(private db: DatabaseSync) {}

  create(c: { projectId: string | null; kind: string; itemIdA: string; itemIdB: string; similarity: number }): ConsolidationCandidate {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO memory_consolidation_candidates (id, project_id, kind, item_id_a, item_id_b, similarity, status, merged_item_id, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, NULL)`
      )
      .run(id, c.projectId, c.kind, c.itemIdA, c.itemIdB, c.similarity, createdAt);
    return this.get(id)!;
  }

  get(id: string): ConsolidationCandidate | null {
    const row = this.db.prepare('SELECT * FROM memory_consolidation_candidates WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToCandidate(row) : null;
  }

  list(filter: { status?: ConsolidationStatus; projectId?: string | null } = {}, limit = 100): ConsolidationCandidate[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.projectId !== undefined) {
      clauses.push('project_id IS ?');
      params.push(filter.projectId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = this.db.prepare(`SELECT * FROM memory_consolidation_candidates ${where} ORDER BY created_at DESC LIMIT ?`).all(...(params as [])) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToCandidate);
  }

  /** Same dedup purpose as ImprovementProposalRepo.hasOpenProposalFor() — a pair already flagged and still awaiting a human decision must not be re-flagged by a repeated scan. Order-independent (a,b) == (b,a). */
  hasOpenCandidateFor(itemIdA: string, itemIdB: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 AS x FROM memory_consolidation_candidates WHERE status = 'open' AND ((item_id_a = ? AND item_id_b = ?) OR (item_id_a = ? AND item_id_b = ?)) LIMIT 1"
      )
      .get(itemIdA, itemIdB, itemIdB, itemIdA);
    return !!row;
  }

  dismiss(id: string): ConsolidationCandidate | null {
    this.db.prepare("UPDATE memory_consolidation_candidates SET status = 'dismissed', decided_at = ? WHERE id = ?").run(Date.now(), id);
    return this.get(id);
  }

  markMerged(id: string, mergedItemId: string): ConsolidationCandidate | null {
    this.db
      .prepare("UPDATE memory_consolidation_candidates SET status = 'merged', merged_item_id = ?, decided_at = ? WHERE id = ?")
      .run(mergedItemId, Date.now(), id);
    return this.get(id);
  }
}
