import type { DatabaseSync } from 'node:sqlite';

export class McpToolPinRepo {
  constructor(private db: DatabaseSync) {}

  get(server: string, tool: string): string | null {
    const row = this.db.prepare('SELECT digest FROM mcp_tool_pins WHERE server = ? AND tool = ?').get(server, tool) as Record<string, unknown> | undefined;
    return row ? (row.digest as string) : null;
  }

  /** Insert-or-replace: the caller (McpClientManager) decides when replacing is legitimate (first sight, or an explicit operator re-pin). */
  set(server: string, tool: string, digest: string): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO mcp_tool_pins (server, tool, digest, first_seen_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(server, tool) DO UPDATE SET digest = excluded.digest, updated_at = excluded.updated_at`
      )
      .run(server, tool, digest, now, now);
  }
}
