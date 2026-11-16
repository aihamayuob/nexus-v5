# ADR-007 — Objectives and acceptance criteria for MCP client, A2A and the Universal Connector SDK

- Date: 2026-11-15
- Status: **PROPOSED** — nothing in this ADR is implemented. Per the permanent instructions, no roadmap item starts without a real objective, bounded scope and explicit acceptance criteria; this ADR supplies them for owner approval. Earlier owner decisions (2026-10-19) kept "MCP client" and "GAP-2 (action gate)" out of scope until an independent decision; the 2026-11-15 request to continue the protocols is read as a request for **this proposal**, not as approval of the designs below.
- Related: ADR-006 (MCP server, VERIFIED within limits; third-party client interop now exercised — see §0).

## 0. Starting point (measured)
- MCP **server**: read-only, `POST /mcp`; tested against the official `@modelcontextprotocol/sdk` 1.32.2 client over Streamable HTTP: 10/10 (`e2e/mcp-third-party-interop.mjs`). Limits unchanged: tools only, no resources/prompts/sessions/SSE.
- MCP client, A2A, Connector SDK: no code.
- The platform already has the two mechanisms every new capability must reuse: the tool registry with VEL effect classes (`pure` / `read_only` / effectful via the Policy Gate + receipts) and the cloud-egress guard (LOCAL_ONLY/PRIVATE never reach the cloud).

## 1. MCP client (NEXUS consumes external MCP servers) — slice M1
**Objective**: let an operator register an external MCP server and expose its **read-only** tools to NEXUS agents through the existing tool pipeline.
**Scope**: Streamable-HTTP and stdio-less (HTTP only) client; `initialize`, `tools/list`, `tools/call`; operator-managed allow-list of servers in config (no agent-initiated registration); each imported tool is registered as `read_only` unless the operator explicitly maps it to an effect class; effectful import only through VEL.
**Security criteria**: (1) server URLs pass the SSRF guard unless explicitly allow-listed by the operator; (2) a task in LOCAL_ONLY/PRIVATE can never call a non-local MCP server (cloud-egress guard applies); (3) tool descriptions/results are treated as untrusted data (prompt-injection guard, output cap); (4) credentials for the remote server never appear in logs/responses; (5) per-call timeout and bounded response size.
**Acceptance (all required)**: A-M1.1 official SDK **server** (a real third-party MCP server process, e.g. the reference `@modelcontextprotocol/server-everything` or an SDK-built one) is listed and one tool is called end-to-end through the built backend; A-M1.2 server down / slow / malformed JSON-RPC → clear error, bounded time, no crash; A-M1.3 privacy-mode egress test with a canary (0 hits); A-M1.4 effectful or unclassified imported tool refused without VEL; A-M1.5 full suite stays green, new tests RED→GREEN with mutation checks.
**Not in M1**: resources, prompts, sampling, OAuth to remote servers, stdio launching of arbitrary commands (code-execution risk → separate decision).

## 2. A2A (agent-to-agent) — slice A1
**Objective**: let NEXUS publish an Agent Card and accept task delegation from an authenticated peer agent, mapped onto existing mission/task execution.
**Open design decision (owner)**: which A2A revision to target and whether NEXUS acts as server only (recommended first), client only, or both. No A2A peer exists in the sandbox, so conformance against a third-party peer must be done by the owner or with an SDK-built reference peer.
**Security criteria**: peer authentication via the gateway key model (no anonymous peers); delegated tasks inherit the strictest routing mode and the VEL gate; the Agent Card advertises only what the effect-class allow-list permits; no peer-supplied URL is fetched without the SSRF guard.
**Acceptance**: A-A1.1 Agent Card served and validated against the protocol schema; A-A1.2 a reference peer (official SDK) submits a task, polls/streams it to completion, cancels another; A-A1.3 unauthenticated and unauthorised peers rejected; A-A1.4 restart recovery (task state survives SIGKILL like missions); A-A1.5 suite green + mutation checks. Interop with a *different vendor's* A2A implementation stays UNVERIFIED unless run.

## 3. Universal Connector SDK — slice C1
**Objective**: a small, documented, versioned contract (TypeScript types + JSON-schema manifest + a test harness) that a third party uses to add a tool/connector without touching core code.
**Scope**: manifest (name, version, declared `effect` class, input/output schemas, timeouts, required secrets by *name*), registration via the existing registry (G8: undeclared `effect` fails at startup), a conformance test kit that a connector author can run, one reference connector (read-only) shipped as the example.
**Security criteria**: manifest effect declaration is enforced, not advisory; secrets resolved by name from server config only; effectful connectors only via VEL; connector code runs in-process only if first-party — third-party code isolation is **not** provided (no OS sandbox exists; `code_execution` stays unregistered), so the SDK must say so.
**Acceptance**: A-C1.1 reference connector passes the conformance kit; A-C1.2 a deliberately bad manifest (missing effect, schema violation, secret value inline) is refused at startup with a clear error; A-C1.3 an effectful connector without VEL is refused; A-C1.4 SDK documentation includes the isolation limitation; A-C1.5 suite green + mutation checks.

## 4. Order and gating
M1 → C1 → A1 (C1 gives A1 and M1 a shared registration contract; recommended, owner may reorder). Each slice: written acceptance criteria before code, RED→GREEN, mutation check, full regression, docs, **STOP** — no slice auto-starts the next. Status of all three: **PENDING** until the owner approves this ADR (or amends it).
