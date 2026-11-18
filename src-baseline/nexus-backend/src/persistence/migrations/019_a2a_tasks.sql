-- NEXUS A2A server (A1, ADR-007 §2). ADDITIVE ONLY: one new table; nothing existing is touched.
-- Rollback: `DROP TABLE a2a_tasks;` + delete this row from _migrations.
-- One row per task created through the A2A endpoint. The task itself lives in `tasks` (the A2A task id IS the NEXUS task id — no parallel state); this table only records
-- WHICH peer (a one-way gateway-key identity, never the key) created it, so GetTask/CancelTask can be restricted to the creating peer.
CREATE TABLE IF NOT EXISTS a2a_tasks (
  task_id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_a2a_tasks_owner ON a2a_tasks(owner);
