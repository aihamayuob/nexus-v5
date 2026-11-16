import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type Volatility = 'low' | 'medium' | 'high';
export type FreshnessStatus = 'fresh' | 'aging' | 'stale';
export type RefreshComparison = 'unchanged' | 'updated' | 'conflicting';
export type FreshnessDecision = 'accepted' | 'dismissed';

export interface FreshnessCheckRecord {
  id: string;
  memoryItemId: string;
  checkedAt: number;
  ageDaysAtCheck: number;
  volatility: Volatility;
  suggestedTtlDays: number;
  status: FreshnessStatus;
  refreshResearched: boolean;
  refreshNewContent: string | null;
  refreshComparison: RefreshComparison | null;
  refreshComparisonRationale: string | null;
  decided: FreshnessDecision | null;
  decidedBy: string | null;
  decidedAt: number | null;
  newMemoryItemId: string | null;
}

function rowToRecord(row: Record<string, unknown>): FreshnessCheckRecord {
  return {
    id: row.id as string,
    memoryItemId: row.memory_item_id as string,
    checkedAt: row.checked_at as number,
    ageDaysAtCheck: row.age_days_at_check as number,
    volatility: row.volatility as Volatility,
    suggestedTtlDays: row.suggested_ttl_days as number,
    status: row.status as FreshnessStatus,
    refreshResearched: (row.refresh_researched as number) === 1,
    refreshNewContent: (row.refresh_new_content as string) ?? null,
    refreshComparison: (row.refresh_comparison as RefreshComparison) ?? null,
    refreshComparisonRationale: (row.refresh_comparison_rationale as string) ?? null,
    decided: (row.decided as FreshnessDecision) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
    decidedAt: (row.decided_at as number) ?? null,
    newMemoryItemId: (row.new_memory_item_id as string) ?? null,
  };
}

export class KnowledgeFreshnessRepo {
  constructor(private db: DatabaseSync) {}

  create(c: {
    memoryItemId: string;
    ageDaysAtCheck: number;
    volatility: Volatility;
    suggestedTtlDays: number;
    status: FreshnessStatus;
    refreshResearched: boolean;
    refreshNewContent: string | null;
    refreshComparison: RefreshComparison | null;
    refreshComparisonRationale: string | null;
  }): FreshnessCheckRecord {
    const id = randomUUID();
    const checkedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO knowledge_freshness_checks (id, memory_item_id, checked_at, age_days_at_check, volatility, suggested_ttl_days, status, refresh_researched, refresh_new_content, refresh_comparison, refresh_comparison_rationale, decided, decided_by, decided_at, new_memory_item_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`
      )
      .run(id, c.memoryItemId, checkedAt, c.ageDaysAtCheck, c.volatility, c.suggestedTtlDays, c.status, c.refreshResearched ? 1 : 0, c.refreshNewContent, c.refreshComparison, c.refreshComparisonRationale);
    return this.get(id)!;
  }

  get(id: string): FreshnessCheckRecord | null {
    const row = this.db.prepare('SELECT * FROM knowledge_freshness_checks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  decide(id: string, decided: FreshnessDecision, decidedBy: string, newMemoryItemId: string | null): FreshnessCheckRecord {
    this.db
      .prepare('UPDATE knowledge_freshness_checks SET decided = ?, decided_by = ?, decided_at = ?, new_memory_item_id = ? WHERE id = ?')
      .run(decided, decidedBy, Date.now(), newMemoryItemId, id);
    return this.get(id)!;
  }

  /** Persists refreshStaleItem()'s re-researched content + comparison verdict onto the SAME row checkFreshness() created — still no decision made, just the proposal filled in. */
  recordRefreshResult(id: string, newContent: string, comparison: RefreshComparison, rationale: string): FreshnessCheckRecord {
    this.db
      .prepare('UPDATE knowledge_freshness_checks SET refresh_researched = 1, refresh_new_content = ?, refresh_comparison = ?, refresh_comparison_rationale = ? WHERE id = ?')
      .run(newContent, comparison, rationale, id);
    return this.get(id)!;
  }

  latestForItem(memoryItemId: string): FreshnessCheckRecord | null {
    const row = this.db.prepare('SELECT * FROM knowledge_freshness_checks WHERE memory_item_id = ? ORDER BY checked_at DESC LIMIT 1').get(memoryItemId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Checks currently flagged 'stale' with no human decision yet — the real, actionable worklist a caller/operator would want (GET /v2/knowledge-freshness/stale). */
  pendingStale(limit = 50): FreshnessCheckRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM knowledge_freshness_checks WHERE status = 'stale' AND decided IS NULL ORDER BY checked_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }
}
