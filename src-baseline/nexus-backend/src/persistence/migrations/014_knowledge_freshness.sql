-- Knowledge Freshness Engine. Tracks, per memory item, whether its
-- content is likely still accurate given how much time has passed and
-- how time-sensitive that KIND of content inherently is (a stock price
-- decays in hours; a mathematical definition never does). A check never
-- mutates memory_items directly — accepting a refresh INSERTS a new
-- memory item (via the existing MemoryRepo.add(), same as every other
-- memory writer in this codebase) and leaves the original exactly as it
-- was, matching the "never delete/overwrite, only add" pattern
-- Dreaming/Memory Consolidation already established for this same table.
CREATE TABLE IF NOT EXISTS knowledge_freshness_checks (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  age_days_at_check REAL NOT NULL,
  volatility TEXT NOT NULL,          -- 'low' | 'medium' | 'high'
  suggested_ttl_days INTEGER NOT NULL,
  status TEXT NOT NULL,              -- 'fresh' | 'aging' | 'stale'
  refresh_researched INTEGER NOT NULL DEFAULT 0,
  refresh_new_content TEXT,
  refresh_comparison TEXT,           -- 'unchanged' | 'updated' | 'conflicting' | null
  refresh_comparison_rationale TEXT,
  decided TEXT,                      -- 'accepted' | 'dismissed' | null
  decided_by TEXT,
  decided_at INTEGER,
  new_memory_item_id TEXT            -- set only when decided = 'accepted'
);

CREATE INDEX IF NOT EXISTS idx_knowledge_freshness_item ON knowledge_freshness_checks(memory_item_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_knowledge_freshness_status ON knowledge_freshness_checks(status);
