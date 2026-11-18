# NEXUS as an A2A server (ADR-007 A1) — status: PARTIAL

Lets another agent (an "A2A client") send NEXUS a task over the Agent2Agent protocol **v1.0, JSON-RPC binding**. Server role only; NEXUS does not call other A2A agents.

## Enable (off by default)
```
NEXUS_GATEWAY_KEYS=<one key per peer, >=16 chars>     # every peer authenticates with a normal gateway bearer key
NEXUS_A2A_PROVIDER=<provider id>                       # REQUIRED to enable. e.g. a LOCAL provider for sensitive deployments
NEXUS_A2A_PUBLIC_URL=https://nexus.example.com         # optional: base URL advertised in the Agent Card (put TLS in front — docs/DEPLOYMENT-TLS.md)
NEXUS_A2A_WAIT_MS=120000                               # optional: how long a blocking SendMessage waits
NEXUS_A2A_MAX_INPUT_CHARS=20000                        # optional
```
Without `NEXUS_A2A_PROVIDER` the Agent Card answers 404 and `POST /a2a` is refused.

## Endpoints
- `GET /.well-known/agent-card.json` — public (no key), like `/v2/health`. Advertises one `JSONRPC` interface at `<base>/a2a`, protocol `1.0`, a Bearer security scheme, **all optional capabilities false**, and one skill (`general-task`).
- `POST /a2a` — JSON-RPC 2.0, requires `Authorization: Bearer <gateway key>`. Methods: `SendMessage` (blocking by default; `returnImmediately` supported), `GetTask`, `CancelTask`. Header `A2A-Version` must be `1.0` (absent = 0.3 → error `-32009`).
- Not implemented → JSON-RPC error `-32004` (unsupported): streaming, subscribe, `ListTasks`, push-notification config, extended Agent Card. Unknown method → `-32601`.

## Security model (what is enforced by code vs. what is only guidance)
- **Authentication**: gateway bearer key (constant-time compare). Failed attempts are throttled per client IP (`authfail:<ip>` bucket → 429). Enforced; tested.
- **Peer isolation**: a task is owned by the gateway key that created it (`a2a_tasks`, migration 019). `GetTask`/`CancelTask` on another peer's task answer "task not found" — existence is not leaked. Enforced; tested.
- **Same engine, same gates**: an A2A task *is* a NEXUS task (same id) run through `claimUnifiedTask`/`dispatchUnifiedTask`: same pipeline, VEL gate, retries, audit. Idempotency key `a2a:<peerKey>:<messageId>` (two peers using the same messageId never collide).
- **Input**: text parts only (url/raw/data parts are rejected), size-limited.
- **No per-peer privacy mode**: peer input is sent to the single operator-configured provider. If that provider is a cloud one, peer text goes to the cloud. Use a local provider for sensitive deployments. The Agent Card does not claim privacy properties.
- **Approvals**: a task that needs a human approval reports `INPUT_REQUIRED`; a peer cannot approve it (an operator does, as today).

## State mapping
pending→`SUBMITTED`, running→`WORKING`, done→`COMPLETED` (artifact = final output), failed→`FAILED`, cancelled→`CANCELED`, approval pending→`INPUT_REQUIRED`.
**Restart behaviour (found and fixed by this slice)**: chat-kind tasks have no checkpoint, so a task in flight when the process dies cannot be resumed; on the next boot it becomes terminal `FAILED` ("interrupted by server restart") instead of staying `WORKING` forever. Completed tasks and their artifacts survive.

## Evidence (all on loopback, simulated model)
`test/a2aServer.test.ts` 14/14; `test/interruptedChatTasks.test.ts` 5/5; `e2e/a2a-third-party-peer.mjs` — the official `@a2a-js/sdk` 1.3.0 client against the BUILT backend as a separate process, including SIGKILL + restart: 9/9. Install the SDK outside the repo and run `A2A_SDK_DIR=/path node e2e/a2a-third-party-peer.mjs` (or set `A2A_SDK_DIR` for `scripts/verify-all.sh`).

## Not claimed
Interop with any other vendor's client; multi-turn (`contextId`/`taskId` continuation), history, non-text parts, streaming/push, Agent Card signing, gRPC/REST bindings; operation over the public internet or real TLS; load/capacity. The spec was read only partially when this was built.
