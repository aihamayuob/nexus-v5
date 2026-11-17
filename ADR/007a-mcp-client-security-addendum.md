# ADR-007a — Security addendum to ADR-007 (MCP client M1 / A2A / Connector SDK) — gate criteria M1.0

- Date: 2026-11-16
- Status: **ACCEPTED as an addendum** under the owner authorization "NEXUS R4 — FULL OWNER AUTHORIZATION" (2026-11-16, §3 "adopt ADR-007 and implement MCP M1, then A2A and the Connector SDK"). Implementation status: see per-slice records.
- Complements `ADR/007-protocol-completion-criteria.md` (R3, owner-supplied), which stays the primary document for objectives/acceptance (A-M1.x, A-A1.x, A-C1.x). Where both state a criterion, the stricter applies. Extends ADR-006.

## Context
ADR-006 lists MCP client, A2A and a connector SDK as "Not decided here". The 2026-11-15 owner-review report and the 2026-11-16 mandate ask for criteria to be written **before** code. This ADR records those criteria only.

## Primary-source check (2026-11-16)
Checked against `modelcontextprotocol.io/specification/versioning`: current revision is **2026-07-28**; each request carries `io.modelcontextprotocol/protocolVersion` in `_meta` (and `MCP-Protocol-Version` header on Streamable HTTP); `server/discover` exists; servers reply `UnsupportedProtocolVersionError` for unsupported versions; initialization-based revisions (<= 2025-11-25) are covered by a backward-compatibility section. **UNVERIFIED** (not read from primary sources yet): the exact tools/list, tools/call, `resultType` and auth details of 2026-07-28; the A2A v1.0 agent-card/`A2A-Version` details (taken from the R3 report only).

## Proposed criteria (M1.0 — gate before any M1 code)
1. **No new runtime dependency** (project has zero runtime deps). Hand-written, deliberately limited client; an official SDK may be used only in an out-of-repo interop test. Any exception needs a written technical justification.
2. **Tool-definition pinning**: on first approval store a hash of each remote tool's name + description + input schema; refuse (and audit) any later change until re-approved (defence against "rug-pull"/tool-poisoning).
3. **Egress safety (SSRF)**: allow only http(s); resolve DNS and reject loopback/link-local/private/metadata ranges unless the owner explicitly allow-lists the host; re-validate on **every redirect hop** (or disable redirects); no credentials forwarded across origins.
4. **Limits** (values to be confirmed by the owner; suggested): 30 s per call, 1 MiB response, 64 tools per server, bounded concurrent calls.
5. **Name separation**: remote tools are namespaced `mcp.<server>.<tool>` and can never shadow a built-in tool.
6. **Kill-switch + audit**: per-server disable flag that takes effect without restart; every connect/list/call/refusal is audit-logged without secrets.
7. **Privacy modes**: connection refused **before any network I/O** when the deployment is LOCAL_ONLY or the data class is PRIVATE.
8. **Effect classes**: remote tools default to `read_only`-equivalent gating; any effectful remote tool needs explicit per-tool owner approval.
9. **A2A inbound** only after F-06 is closed (F06-a done 2026-11-16; TLS via documented reverse proxy F06-b still PENDING), authenticated like every non-health route, no task execution without the existing pipeline.
10. **Acceptance tests first** (RED before code): pinning mismatch, redirect-to-private-IP, oversize response, name collision, kill-switch, LOCAL_ONLY refusal, no-secret-in-log.

## Not decided here
Whether to ship M1 at all before a first buyer demo; transport choice (Streamable HTTP only vs stdio); A2A scope; connector SDK shape.

---

## Implementation record — M1 (2026-11-17) — status: PARTIAL (see limits)

Implemented under R4 owner authorization (autonomous engineering). Code: `src-baseline/nexus-backend/src/mcp/mcpClient.ts`, `ssrfGuard.safeRequest`, migration `018_mcp_tool_pins.sql`, `tools/bootstrap.registerExternalReadOnlyTool`, routes `GET /v2/mcp/client` and `POST /v2/mcp/client/:name/enabled`. Tests: `test/mcpClient.test.ts` (19, written RED first; the module-missing RED and the exposure-gap RED were both observed failing for the missing behavior), `e2e/mcp-client-third-party.mjs` (official `@modelcontextprotocol/sdk` 1.32.2 **server**, JSON and SSE framing, stateless transport: 11/11). Full backend suite 723/723, typecheck clean.

Acceptance mapping (ADR-007 A-M1.x): A-M1.1 real third-party server — VERIFIED for the SDK server above only (one vendor SDK, one version; no other server implementation tested). A-M1.2 failure modes (down/slow/malformed/oversize/too-many-tools) — VERIFIED against a local fake. A-M1.3 privacy canary — VERIFIED (0 requests on restricted task / local-provider caller; control reaches the meter); limit: task restriction marks live in process memory (same limit as GAP-1B). A-M1.4 effectful/unclassified refusal — VERIFIED (annotations from an untrusted server are only a *second* gate after the operator allow-list). A-M1.5 mutation checks — 13/14 mutants killed; the survivor (`!cfg.enabled` alone in `callTool`) is an equivalent mutant (disable also clears `connected`, which has its own killed guard).

Deviations/decisions needing owner confirmation:
1. Tool naming is `mcp__<server>__<tool>` (server names `[a-z][a-z0-9-]{0,31}`), chosen so a remote cannot shadow a built-in. Confirm or specify another scheme.
2. Default limits 30 s / 1 MiB / 64 tools per server (env `NEXUS_MCP_TIMEOUT_MS`, `NEXUS_MCP_MAX_BYTES`, `NEXUS_MCP_MAX_TOOLS`). Unconfirmed defaults.
3. Imported tools are never re-exposed through NEXUS's own `/mcp` server (hard exclusion of the `mcp__` prefix) — a deliberate confused-deputy rule beyond the ADR text.
4. Registration goes through one narrow wrapper in `tools/bootstrap.ts` (name pattern + `read_only` + no `effect`), so the G8-10 / G81-7 source guards were NOT weakened.

Known limits (not claimed): stdio transport, resources/prompts/sampling/roots, OAuth, and the stateless 2026-07-28 request style are NOT implemented; the client speaks the initialize handshake (UNVERIFIED against servers that dropped it). The tool `input_schema` is flattened to the project's lite schema (nested/array item schemas are not forwarded to model providers). The untrusted-data label on results is model guidance, not enforcement. No real-world remote server (public internet, TLS, auth token flow) was exercised: only loopback fakes and the SDK server on 127.0.0.1 — real bearer/TLS operation is UNVERIFIED.
