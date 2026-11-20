# NEXUS API contract (as implemented) — extracted from the route registrations on branch `work/r4-backend-html` (base `52b12c14`)

Status: **VERIFIED for the route table and for the endpoints marked ✔ (exercised by `e2e/standalone-html-flow.mjs` against the built backend, 2026-11-20).** Request/response bodies of other endpoints are documented only where the source was read; anything not listed here is **not** claimed to exist. Source of truth is `src-baseline/nexus-backend/src/routes/**` — if this file and the code disagree, the code wins.

## Conventions
- Base URL: `http://<NEXUS_HOST>:<NEXUS_PORT>` (default bind `127.0.0.1:8787`). Plain HTTP; for any non-loopback network use TLS via a reverse proxy (`docs/DEPLOYMENT-TLS.md`).
- Auth: `Authorization: Bearer <gateway key>` (keys come from `NEXUS_GATEWAY_KEYS`). Only `GET /v2/health` and the A2A agent card are unauthenticated. Cookies are not used (no CSRF surface; browser credentials are never needed).
- CORS: allow-list from `NEXUS_CORS_ORIGINS` only. A foreign `Origin` receives no `Access-Control-Allow-Origin`. `file://` pages have origin `null` and are not allowed (by design).
- Errors: JSON `{ "error": { "code": "<slug>", "message": "<text>" } }` with 400 validation, 401 `auth_error`, 404, 429 (rate limit / failed-auth throttle), 5xx.
- Failed-auth throttle: per client IP (`X-Forwarded-For` honoured only from `NEXUS_TRUST_PROXY`).
- Routing modes accepted by `/v2/route`: `BEST, CHEAPEST, FASTEST, LOCAL_ONLY, PRIVATE, USER_SELECTED`. **There is no CLOUD or HYBRID mode.** Mission creation takes no mode; the server chooses the provider.
- Mission states: `PLANNING, RUNNING, REPLANNING, AWAITING_APPROVAL, PAUSED, COMPLETED, FAILED, CANCELLED` (terminal: the last three). Mission id == task id (`plan_<ts>_<hex>`).
- Evidence statuses used by claim evaluation/receipts: `VERIFIED, SUPPORTED, UNCERTAIN, CONFLICTING, UNVERIFIED`.

## Endpoints used by the standalone page (✔ = exercised in E2E)
| Method | Path | Notes |
|---|---|---|
| GET ✔ | `/v2/health` | no auth. `{ok, version, runningCount, maxConcurrency}` |
| GET ✔ | `/v2/models` | `{version, providers:[{id,label,defaultModel,capabilities:{isLocal,tools,images,webSearch,streaming},configured}]}` |
| GET ✔ | `/v2/providers/health[?probe=1]` | `{providers:[{id,state:READY\|DEGRADED\|UNAVAILABLE\|NOT_CONFIGURED,live,latencyMs,error}]}` |
| POST ✔ | `/v2/route` | body `{mode, provider?, needsTools?, needsImages?, needsWebSearch?}` → `{mode,provider,model,fallbacks,cloudFallbackBlocked}`. Preview only. |
| POST ✔ | `/v2/missions` | body `{objective, completionCriteria?:{requireAllTasksDone,runVerification,requireVerificationOk,requireApprovalOnIssues,minTaskSuccessRatio}, maxReplans?, idempotencyKey?}` → **202** `{missionId}` |
| GET ✔ | `/v2/missions/:id` | `{id,objective,state,completionCriteria,failures[],retryCount,replanCount,maxReplans,result:{finalOutput,verification,evaluation}\|null,createdAt,startedAt,completedAt,taskStatus}` |
| GET ✔ | `/v2/missions/:id/transitions` | `{transitions:[{toState,createdAt,reason}]}` |
| POST | `/v2/missions/:id/{cancel,pause,resume}` | state-machine guarded |
| GET ✔ | `/v2/tasks/:id/stream?afterId=0` | SSE (`event:`/`data:`), replays then follows; optional for the page |
| GET | `/v2/tasks/:id` | `{task, approval}` |
| GET ✔ | `/v2/approvals` ; POST `/v2/approvals/:taskId/decide` `{decision:"approved"\|"rejected"}` | human gate |
| GET ✔ | `/v2/execution-receipts?taskId=&unresolved=1&limit=` | VEL receipts |
| GET ✔ | `/v2/evaluation/claims?limit=` | `{evaluations:[{subjectId,claim,verdict,confidence,rationale,…}]}` |
| GET ✔ | `/v2/warden/status` ; `/v2/mcp/client` ; `/.well-known/agent-card.json` | operational snapshot; MCP client status (`{configured,servers}`); A2A card (404 unless `NEXUS_A2A_PROVIDER` set) |

## Complete route table (96 `router.<verb>(` registrations: 93 single-line + 3 multi-line — health, agent-card, embed; static scan 2026-11-20)
`GET /v2/health`(no auth) · `GET /.well-known/agent-card.json` · `POST /a2a` · `POST /mcp` (read-only MCP server) · `POST /api/embed`
Legacy (`/api/*`): `GET|POST /api/audit/veto`, `POST /api/chat`, `GET /api/chat/resume/:requestId`, `GET /api/market-context`, `POST /api/runtime/{plan,run}`, `POST /api/runtime/:taskId/cancel`, `GET /api/runtime/resume/:taskId`, `GET|POST /api/schedules`, `DELETE|PATCH /api/schedules/:id`, `GET|PUT|DELETE /api/sync`, `POST /api/tools/fetch`
v2: `GET /v2/{models,providers/health,observability,budget}` · `POST /v2/route` · `POST /v2/tasks` (SSE; client disconnect cancels the task), `GET /v2/tasks/:taskId`, `POST /v2/tasks/:taskId/cancel`, `GET /v2/tasks/:taskId/stream` · missions (above) · `POST /v2/council`, `GET /v2/council/:id[/rounds]`, `POST /v2/council/:id/cancel` · `POST /v2/swarm` · `POST /v2/research/web` · `POST /v2/feedback` · approvals · `GET /v2/warden/{status,agents/isolated}`, `POST /v2/warden/agents/:agentId/{isolate,deisolate}` · `GET /v2/execution-receipts[/:id]`, `POST /v2/execution-receipts/:id/reconcile` · evaluation: `POST /v2/evaluation/{run,claim}`, `GET /v2/evaluation/{latest,history,claims,claims/:id}` · `GET /v2/mcp/client`, `POST /v2/mcp/client/:name/enabled` · dreaming, evolution, finetuning, iot, knowledge-freshness, metacognition families (candidate/proposal/approval style endpoints; see the route files — not exercised by the standalone page).

## Not in the API (do not invent)
CLOUD/HYBRID run modes · per-mission provider/mode selection · server-sent mission-wide event stream other than `/v2/tasks/:id/stream` · cookie/session auth · any write endpoint for provider keys (keys are environment-only).
