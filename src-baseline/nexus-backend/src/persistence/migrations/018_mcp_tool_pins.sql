-- NEXUS MCP client (M1, ADR-007 + ADR-007a). ADDITIVE ONLY: one new table; no existing table/column/row is touched.
-- Rollback: `DROP TABLE mcp_tool_pins;` (nothing references it) + delete this row from _migrations.
--
-- Tool-definition pinning (anti "rug-pull"): the first time an operator-allow-listed remote tool is imported, a SHA-256 digest of its definition
-- (description + inputSchema + annotations) is recorded. A later connection whose digest differs is REFUSED until the operator explicitly re-pins.
-- The digest is a hash of public tool metadata published by the remote server; it carries no credential and no user data.
CREATE TABLE IF NOT EXISTS mcp_tool_pins (
  server TEXT NOT NULL,
  tool TEXT NOT NULL,
  digest TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (server, tool)
);
