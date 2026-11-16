-- Phase 2 (Mission/Agent Runtime): a Mission is a NAMED, richer wrapper
-- around an existing 'runtime_plan' task (mission.id == tasks.id, 1:1) —
-- NOT a parallel execution engine. The DAG itself still runs through the
-- already-tested dag.ts/dag_nodes/checkpoints machinery unchanged; this
-- table adds what that machinery deliberately doesn't track on its own:
-- the objective as first-class queryable text (previously only reachable
-- via a checkpoint blob), an explicit state machine richer than tasks.status,
-- completion criteria, aggregated failures/retries, and bounded replanning
-- counters — the exact fields NEXUS Phase 2 §A requires.
CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,               -- == tasks.id
  objective TEXT NOT NULL,
  state TEXT NOT NULL,               -- 'PLANNING'|'RUNNING'|'AWAITING_APPROVAL'|'REPLANNING'|'COMPLETED'|'FAILED'|'CANCELLED'
  completion_criteria_json TEXT NOT NULL,
  failures_json TEXT NOT NULL DEFAULT '[]',   -- structured list: [{source, message, at}]
  retry_count INTEGER NOT NULL DEFAULT 0,     -- sum of dag_nodes attempts beyond the first, updated on completion
  replan_count INTEGER NOT NULL DEFAULT 0,
  max_replans INTEGER NOT NULL DEFAULT 1,     -- hard cap — see missionRunner.ts's bounded replanning loop
  result_json TEXT,                           -- {finalOutput, evaluation, verification} once available
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_missions_state ON missions(state);

-- State transition audit (NEXUS Phase 2 §E: "state transition audit").
-- Append-only — never updated or deleted (except cascade with the mission
-- itself), so "how did this mission get to FAILED" is always reconstructable.
CREATE TABLE IF NOT EXISTS mission_state_transitions (
  mission_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  from_state TEXT,                   -- NULL for the very first transition (mission creation)
  to_state TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (mission_id, seq),
  FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);

-- Agent failure history (NEXUS Phase 2 §B: AgentDefinition.failureHistory).
-- Agent DEFINITIONS themselves are static config (agentRegistry.ts, same
-- pattern as providerRegistry.ts) — only the dynamic, accumulating
-- failure record needs persistence.
CREATE TABLE IF NOT EXISTS agent_failures (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  mission_id TEXT,                   -- nullable: an agent can also run standalone, outside any Mission
  task_node_id TEXT,
  provider TEXT,
  error_message TEXT NOT NULL,       -- short summary only, never raw completion text — same rule as provider_call_log
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_failures_agent ON agent_failures(agent_id, created_at DESC);
