# NEXUS Connector SDK (C1) — author guide

Status: **PARTIAL** — code + 7 tests + mutation checks exist (see ADR/007a implementation record); one reference connector; no third-party connector has been written or run.

## ⚠ Isolation limitation (read first)
Connectors run **in-process with the full privileges of the NEXUS backend**. NEXUS has no OS sandbox (the `code_execution` tool stays unregistered for the same reason). `ctx.secret(name)` limits *accidental* access to undeclared secrets; it is **not** a security boundary against hostile code (a connector can read `process.env` directly). Register only first-party, code-reviewed connectors. The SDK deliberately has **no dynamic loading** of third-party code: connectors are added to the code-level list in `src/connectors/registry.ts` through a reviewed change.

## Contract
A connector = `ConnectorManifest` + `ConnectorImpl` (`src/connectors/connectorSdk.ts`).

| Manifest field | Rule (enforced by `validateManifest`) |
|---|---|
| `manifestVersion` | must be `1` |
| `name` | `^[a-z][a-z0-9_]{2,40}$`, not `mcp__*`, not already registered |
| `version` | semver `x.y.z` |
| `description` | 5–1000 chars |
| `effect` | **mandatory**: `pure` \| `read_only` \| `effectful` |
| `effectReason` | ≥ 10 chars (an attestation, not a proof) |
| `inputSchema` | `{type:'object', properties:{name:{type}}, required?}`; `required` must name existing properties |
| `timeoutMs` | integer 100–120000 |
| `requiredSecrets` | env-var **names** (`A-Z0-9_`) only; secret literals anywhere in the manifest are refused |
| any other key | refused |

Implementation rules (enforced by `registerConnector`):
- `pure` / `read_only` → must provide `execute(input, ctx)` and **no** `effect`.
- `effectful` → must provide a VEL `effect` spec (see `tools/effectTypes.ts`), **no** `execute`, and VEL must be enabled; the connector is then reachable only through the VEL gate (policy → write-ahead receipt → dispatch → independent read-back).
- Every declared secret must be set in the environment at registration; `ctx.secret(name)` throws for undeclared names.
- Registration goes through `tools/bootstrap.ts#registerConnectorTool` (the only file allowed to call `registry.register`).
- The boot path (`registerConnectors`) is all-or-nothing and **throws** on an invalid entry, so the process does not start with an unsafe connector set.

## Conformance kit
`runConformance(manifest, impl, {valid:[…], invalid:[…]})` checks: manifest validity, implementation shape vs declared effect, declared secrets present, samples satisfy/violate the schema, each valid call returns a string ≤ 20 000 chars without control characters within `timeoutMs`, and the result never contains a declared secret value. Effectful connectors get a structural check of the effect spec only (the kit never dispatches an effect).

## Reference connector
`src/connectors/reference/textStatsConnector.ts` (`text_stats`, pure). It is an example and is **not registered by default** (`FIRST_PARTY_CONNECTORS` is empty).

## Not covered
Hot reload, a package/distribution format, signing, per-connector rate limits, output schemas, OAuth flows, and any isolation of untrusted code.
