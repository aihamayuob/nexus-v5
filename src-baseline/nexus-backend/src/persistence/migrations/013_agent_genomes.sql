-- Phase 3 — Controlled Agent Evolution ("Digital Genome"). Durable,
-- versioned history of proposed/approved system-prompt mutations for
-- agents, satisfying the platform's own hard rule for any self-modifying
-- capability: versioned + evaluated + security-checked + approved +
-- rollbackable. Nothing is ever deleted — rollback means re-activating an
-- older row, never rewriting history. Additive-only new table.
--
-- status lifecycle: 'proposed' -> ('rejected' automatically if the
-- deterministic security check fails, or manually by a human reviewer) |
-- ('active' once a human approves it — atomically superseding whatever
-- was previously 'active' for the same agent_id, which moves to
-- 'superseded'). A rollback re-activates an older 'superseded' row
-- (moving the current 'active' row back to 'superseded' itself) — the
-- state machine has no destructive transition anywhere.
CREATE TABLE IF NOT EXISTS agent_genomes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_version INTEGER,
  system_prompt TEXT NOT NULL,
  rationale TEXT NOT NULL,
  security_check_passed INTEGER NOT NULL,
  security_check_findings_json TEXT NOT NULL,
  evaluation_verdict TEXT,
  evaluation_rationale TEXT,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  decided_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_genomes_agent ON agent_genomes(agent_id, version);
CREATE INDEX IF NOT EXISTS idx_agent_genomes_active ON agent_genomes(agent_id, status);
