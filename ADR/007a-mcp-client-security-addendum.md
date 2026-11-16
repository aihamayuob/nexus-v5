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
