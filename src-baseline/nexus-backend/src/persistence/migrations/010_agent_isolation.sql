-- Phase 3 Slice 13 (Warden ISOLATE). Durable record of agents an operator
-- has isolated (blocked from executing any new task) via Warden. Presence
-- of a row for an agent_id = isolated; absence = normal operation. This
-- is enforced as a real boundary in agents/agentRunner.ts's runAgentTask()
-- — checked as the FIRST line of that function, before any provider/tool
-- work begins — not merely advisory metadata. Additive-only (new table),
-- no existing schema touched.
CREATE TABLE IF NOT EXISTS warden_agent_isolation (
  agent_id TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  isolated_at INTEGER NOT NULL
);
