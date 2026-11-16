# ADR-006 — Minimal read-only MCP server (JSON-RPC over HTTP `POST /mcp`)

- Date: 2026-11-14
- Status: **ACCEPTED** (owner authorization of 2026-11-14: "complete the architecture incl. MCP & A2A"); implementation status **VERIFIED within the limits below**
- Scope: one bounded slice. A2A and the Universal Connector SDK are **NOT** part of this ADR (status PENDING — see "Not decided here").

## Context
The owner mandate lists "MCP & A2A" and a "Universal Connector SDK" as architecture components. A repository-wide search showed no MCP/A2A/connector code existed in the baseline. NEXUS already has a tool registry whose tools carry a VEL effect classification (`pure` / `read_only` / `legacy_exempt`; effectful tools run only through the VEL gate).

## Decision
Add `POST /mcp` (JSON-RPC 2.0, single request per POST, no batching, no SSE/sessions) implementing only: `initialize`, `ping`, `notifications/initialized`, `tools/list`, `tools/call`. Capabilities advertised: `tools` only.

Security rules (least privilege):
1. **Authenticated** like every non-health route (not `skipAuth`). Unauthenticated → 401.
2. **Exposure allow-list by effect class**: only `pure` tools with a local `execute()` are listed/callable. `read_only` tools (e.g. `web_fetch`, which performs server-side network egress) require the explicit opt-in `NEXUS_MCP_EXPOSE_READ_ONLY=1`. Effectful (VEL) and `legacy_exempt` tools are **never** exposed; the pipeline additionally refuses an effectful tool when the caller is `mcp` (defence in depth).
3. `tools/call` runs through the **unchanged tool pipeline** (registry lookup → budget check → JSON-schema validation → execution → output cap). The only change in the pipeline is the caller type `'mcp'`, which skips the per-*provider* capability check (there is no provider) and nothing else.
4. Unknown / non-exposed tool → JSON-RPC error `-32602` (never executed); tool-level failure → `isError:true` result, not a protocol crash; malformed input → `-32700` / `-32600`; unknown method → `-32601`.

## Evidence (this commit)
- `test/mcpServer.test.ts`: RED 0/10 (endpoint absent) → GREEN 10/10.
- Full backend suite 638/638 (628 prior + 10 new); typecheck clean; build OK.
- `e2e/operational-scenarios.mjs` S8: 5 checks against the **built** backend process (401 without key; initialize; tools/list = `calculate` only; `calculate` = 42; `web_fetch` refused).

## Limits / not claimed
- Server side only. No MCP **client** (NEXUS cannot consume external MCP servers).
- Only one pure tool (`calculate`) exists today, so the exposed surface is intentionally tiny. Interoperability with a third-party MCP client (e.g. Claude Desktop) was **not** exercised: UNVERIFIED. Protocol version string `2025-03-26` is advertised; conformance beyond the tested methods is UNVERIFIED.
- No resources, prompts, sampling, roots, notifications other than `initialized`/`cancelled`, no streamable-HTTP session handling.

## Not decided here (PENDING, needs a real objective + acceptance criteria)
- **A2A** (agent-to-agent protocol): not implemented.
- **Universal Connector SDK**: not implemented.
- Exposing VEL-gated effectful tools over MCP: would need a design that routes through the Policy Gate/receipt flow and an approval UX; deliberately excluded.
