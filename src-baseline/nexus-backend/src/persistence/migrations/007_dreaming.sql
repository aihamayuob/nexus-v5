CREATE TABLE IF NOT EXISTS memory_consolidation_candidates (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  kind TEXT NOT NULL,
  item_id_a TEXT NOT NULL REFERENCES memory_items(id),
  item_id_b TEXT NOT NULL REFERENCES memory_items(id),
  similarity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'merged' | 'dismissed' — human-decided only
  merged_item_id TEXT, -- set only when status='merged' — the NEW consolidated item; item_id_a/item_id_b are NEVER deleted or modified by this process
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_consolidation_status ON memory_consolidation_candidates(status);
