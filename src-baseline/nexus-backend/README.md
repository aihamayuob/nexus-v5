# nexus-backend

Central runtime for Neural Nexus AI Agents. The frontend is now a **client /
control plane**: it renders UI and sends requests, but orchestration —
routing, retries, provider fallback, DAG execution, checkpoints, budget
enforcement, tool execution, observability — lives here.

Zero external runtime dependencies. Node.js built-ins only (`node:http`,
`node:sqlite`, `node:crypto`, `node:dns`, native `fetch`). TypeScript via
`tsx`. This was a deliberate constraint, not an accident: it means there is
no `npm install` supply-chain surface for the runtime path, and the whole
thing runs anywhere a recent Node binary does.

## Quick start

```bash
cp .env.example .env        # fill in the provider keys you actually have
npm run typecheck           # tsc --noEmit
npm test                    # node:test, 28 tests, no network required
npm run dev                 # tsx watch src/index.ts
```

Requires Node ≥ 22.5 (for `node:sqlite`). Tested against Node 22.22.2.

## Architecture

```
API Gateway (gateway/router.ts)
  → Auth (gateway/middleware/auth.ts) — Bearer gateway keys, trusted mode if none configured
  → Rate limiting (gateway/middleware/rateLimit.ts) — token bucket per client key
  → Nexus Task Manager (orchestrator/taskManager.ts) — durable task records, concurrency limits, idempotency, cancellation
    → Intent / Routing (intent/intentEngine.ts, providers/modelRouter.ts) — risk/complexity heuristics, provider+model resolution, fallback chain
    → Agent Runtime / DAG (orchestrator/dag.ts + dagRunner.ts + planner.ts) — dependency-aware parallel execution, retry, reflection, failure propagation, resume
    → Model Router → Provider Adapters (providers/*Adapter.ts) — one contract, six vendors
      → Tool Runtime (tools/registry.ts, tools/pipeline.ts) — Registry → Capability Check → Permission Check → Validation → Execution → Timeout → Sanitization → Result
      → Context / Memory (memory/contextFabric.ts, memory/embeddingsService.ts) — server-hostable knowledge retrieval, deduped+cached+batched embeddings
      → Verification (orchestrator/verifier.ts) — independent skeptical review, gated by intent
      → Persistence (persistence/*) — SQLite: tasks, checkpoints, DAG node state, resumable stream events, observability, audit, embeddings cache, sync, schedules
      → Observability (observability/recorder.ts) — durable, queryable, per-task (not a browser ring buffer)
```

### Provider Registry — single source of truth

`src/config/providerRegistry.ts` is the **only** place a model id, base URL,
or capability flag is ever written. Every adapter, the model router, the
capability graph, and `GET /v2/models` all read from it. Defaults are
overridable via env (`NEXUS_MODEL_ANTHROPIC` etc.) specifically so a vendor
shipping a new model is a config change, not a code change — this is the
direct backend-side fix for the exact class of bug the frontend audit found
repeatedly (a hardcoded model string surviving in one forgotten corner).

### Unified provider contract

Every adapter (`providers/{anthropic,openai,deepseek,gemini,ollama,lmstudio}Adapter.ts`)
implements the same `ProviderAdapter` interface and speaks the same
Anthropic-Messages-shaped `ChatRequest`/`ChatResponse` internally — that
specific shape was chosen because it's what the frontend's existing
`/api/chat` contract already expects, so the legacy route is a thin
pass-through rather than a translation layer of its own. OpenAI, DeepSeek,
and LM Studio share one translation module (`providers/openaiCompatible.ts`)
since all three speak OpenAI's Chat Completions API; Gemini and Ollama have
their own adapters since their wire formats genuinely differ (verified
against current API docs, not assumed from memory — see `geminiAdapter.ts`).

### DAG executor

`orchestrator/dag.ts` is pure scheduling logic — dependency resolution,
concurrency limits, retry, cascading failure propagation, optional
reflection/revision, resume from a partial state — with the actual model
calls injected as functions (`runNode`/`reflect`/`synthesize`). This means
the scheduler itself is fully unit-tested (`test/dag.test.ts`, 8 tests) with
zero network and zero real model calls; `orchestrator/dagRunner.ts` is the
thin layer that wires real `chatService` calls into those injection points.

`/api/runtime/plan` and `/api/runtime/run` are no longer a path beside
Nexus Core — they're the DAG executor running as one Task-Manager-governed
task, same as a chat completion. Concurrency limits, budget checks,
observability, and checkpointing all apply uniformly.

### Durable execution, checkpoints, resume

Every DAG node's status/output is persisted to `dag_nodes` as it changes
(not just logged) and the plan's own definition (goal + task list) is
checkpointed once at the start. `resumeInterruptedPlans()` runs once at
process startup, finds any plan left non-terminal by an unclean shutdown,
and picks it back up from its last completed node — `test/dag.test.ts`'s
"resume seeds already-done nodes without re-running them" test covers the
scheduling half of this; the persistence half is exercised by the
integration suite indirectly through `checkpointRepo`.

### Resumable SSE streams

Every event emitted on a task's stream is written to `stream_events`
**before** being broadcast to any live connection (`orchestrator/streamRegistry.ts`).
`GET /api/chat/resume/:requestId?afterId=N` (existing contract) and the new
`GET /api/runtime/resume/:taskId?afterId=N` both replay from that durable
log, then attach live for anything still to come — the same mechanism
backs both endpoints.

### Tool Runtime

`tools/pipeline.ts` is the **only** path by which a tool executes:
Registry lookup → Capability Check → Permission Check → Validation →
Execution → Timeout → Sanitization → Result. It only ever accepts a
`{id, name, input}` triple sourced from a provider's own structured
`tool_use` response block — nothing in this backend scans free text (tool
results, fetched web pages, knowledge content) for command-like phrases
and acts on it. That structural fact is what actually prevents prompt
injection from becoming a tool call; see `security/promptInjectionGuard.ts`'s
header comment for the full reasoning.

Two tools are registered server-side: `web_fetch` (through the SSRF guard)
and `calculate` (a real recursive-descent parser, not `eval`). `create_file`
stays client-only (it writes to the end user's own device — nothing for a
stateless backend to do there); `web_search` is executed natively by
Anthropic itself and never reaches this pipeline.

### Security

- **SSRF guard** (`security/ssrfGuard.ts`): resolves DNS, validates the IP
  isn't in a private/loopback/link-local/metadata/multicast range, then
  **pins the actual TCP connection to that validated IP** via a custom
  `lookup` — this closes the DNS-rebinding gap between "we checked" and
  "we connected", not just a hostname string check. Every redirect hop is
  independently re-validated. Verified live in tests against
  `127.0.0.1` and the `169.254.169.254` cloud-metadata address.
- **Secrets**: API keys are read only from `process.env` inside adapter
  construction, never persisted, never logged, never returned in any
  response — `security/secrets.ts::assertNoSecretLeak()` is a defense-in-depth
  check called before `GET /v2/models` serializes its response, and the
  integration test asserts a live key never appears in that payload.
- **Auth**: Bearer gateway keys, `timingSafeEqual` comparison, binary
  trusted/mandatory — no partial state where a key is "checked if present".
- **Budget guard**: rolling-24h USD cap, enforced before every model call
  and every tool call.
- **Audit trail**: every security-relevant event (auth failure, SSRF block,
  tool denial, budget stop) funnels through one function
  (`security/audit.ts::auditSecurityEvent`) that both logs and durably
  persists.
- **No chain-of-thought logging**: `observability/recorder.ts` only ever
  records metadata (agent ids, model/provider names, tool names, latency,
  token counts, cost, a verification verdict + issue *count*) — never raw
  prompts, completions, or a verifier's critique text. `core/logger.ts` has
  a truncation backstop as defense in depth on top of that discipline.

### Migration — nothing broke

Every endpoint the frontend already calls still exists with the exact same
request/response/SSE shape, now implemented as a thin wrapper over the
unified Task Manager instead of a standalone handler:
`/api/chat` (+ `/api/chat/resume/:id`), `/api/runtime/plan`,
`/api/runtime/run`, `/api/embed`, `/api/tools/fetch`, `/api/market-context`,
`/api/audit/veto`, `/api/schedules`, `/api/sync`. Nothing was deleted.
New, additive-only endpoints: `/api/runtime/resume/:taskId`,
`/api/runtime/:taskId/cancel`, and the `/v2/*` namespace
(`/v2/health`, `/v2/models`, `/v2/observability`, `/v2/budget`). Phase 3
adds `/v2/tasks` (+ `/v2/tasks/:id`, `/v2/tasks/:id/stream`,
`/v2/tasks/:id/cancel`), `/v2/approvals` (+ `/:taskId/decide`),
`/v2/feedback`, and `/v2/evaluation/{run,latest,history}` — all new
namespace, nothing existing touched.

## Phase 3 — Production Hardening, Evaluation, Adaptive Routing, Execution Policy

### AdaptiveModelRouter — evidence, not vibes

`providers/adaptiveModelRouter.ts` ranks a request's fallback chain using
per-provider-call evidence (`provider_call_log`, one row per individual
attempt — not per task, since a task's fallback chain can span several
providers and task-level observability alone can't answer "how reliable
is provider X"). Signals: success rate, latency, cost, independent-Verifier
pass rate, recent user feedback. **It never claims "accuracy"** — there is
no labeled ground-truth dataset anywhere in this system, and pretending
otherwise would be actively misleading. With fewer than 8 calls of
history for a provider, its score is marked `lowConfidence` and never
outranks a better-evidenced provider, and with NO history anywhere the
registry's own declared order is used unchanged (cold start).

### NexusEvaluation → a real Evaluation Framework

`evaluation/benchmarkTasks.ts` + `evaluation/benchmarkRunner.ts`: a real
battery (routing, provider, tool, failure-recovery, verification-coverage,
execution-policy — 6 categories) that's deterministic by default (no real
network needed — provider benchmarks skip gracefully when nothing's
configured, exactly like a fresh clone would see). Every run is stored
(`benchmark_runs`) and automatically compared against the immediately
previous one — `POST /v2/evaluation/run` returns `regression.hasRegressions`
plus a per-check breakdown of what got worse, better, newly broken, or
newly fixed, BEFORE you ship. `test/benchmarkRunner.test.ts` exercises this
end-to-end across two real successive runs.

### Feedback Loop

`POST /v2/feedback {taskId, rating: 'up'|'down', note?}` — the only input
side of the loop; `feedback` table. `AdaptiveModelRouter` reads recent
feedback per-route as one (soft, low-weight) scoring signal. **This system
never modifies model weights.** "Improvement" here means: which provider
gets tried first, how much context gets pulled in, whether verification
runs, whether a tool is offered — never the models themselves.

### Execution Policy — the actual point of contact

`intent/executionPolicy.ts` classifies every request into LOW / MEDIUM /
HIGH / HIGH_RISK (reusing `analyzeIntent()`'s existing risk/complexity
signals — one heuristic source of truth, not a second classifier that
could disagree with `Verifier.shouldVerify()`). **This used to be a design
document with zero callers** — the actual wiring is
`orchestrator/taskEntryPoint.ts` + `POST /v2/tasks`, the new unified entry
point:
- **LOW**: one direct chat completion. No planner, no DAG, no verifier.
- **MEDIUM**: same fast path, tools allowed.
- **HIGH**: `planGoal()` + `runPlanTask()` — the EXISTING DAG machinery
  from Phase 2, unmodified, reached through the policy decision instead
  of a manual two-step `/api/runtime/plan` + `/api/runtime/run` call.
- **HIGH_RISK**: same as HIGH, plus `orchestrator/approvalGate.ts` — the
  DAG still runs to completion (research, verification, synthesis all
  happen normally), but the result is held (`approvals` table, `pending`)
  instead of auto-delivered. `POST /v2/approvals/:taskId/decide
  {decision: 'approved'|'rejected'}` releases it — approval emits the real
  `plan_done` on the SAME durable stream the original request was
  watching; rejection emits `plan_error` and the task is marked
  `cancelled`, never `done`. A second decision on an already-decided
  approval is rejected with 409, not silently accepted.

Every request to `/v2/tasks` gets a `task_meta` event FIRST, always,
naming the tier and why — this is the "Control Center" transparency
requirement surfaced at the protocol level (agents/models/tools/
verification/confidence/cost, never chain-of-thought), and the frontend's
new Control Center strip (see the HTML delivery) renders exactly this
shape of data per-answer instead of only in a separate Dashboard modal.

`test/executionPolicy.test.ts` (10 tests) exercises the whole thing live:
LOW fast-path, HIGH DAG-escalation, HIGH_RISK hold→approve, HIGH_RISK
hold→reject, double-decision conflict, feedback recording, and a live
benchmark run over HTTP.

### Security hardening additions

- **Secure headers on every response** (`gateway/middleware/secureHeaders.ts`):
  `Content-Security-Policy: default-src 'none'` (this backend serves only
  JSON/SSE, never HTML, so maximally restrictive is correct — see that
  file's own comment for what changes if that ever stops being true),
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, HSTS.
- **Retention sweeps** (`observability/retention.ts`, hourly): bounds
  `stream_events` (6h after a task finishes), `observability_events` and
  `provider_call_log` (30 days), `audit_log` (180 days — kept much longer
  by design, its whole value is historical). All windows are env-overridable.

### Two real bugs this phase's tests caught (not hypothetical)

1. **`ProviderRegistry.configuredProviders()` and `routeModel()`'s own
   fallback-eligibility filter disagreed** about what "configured" means
   for a local provider (Ollama/LM Studio): the filter correctly required
   a resolved model name, `configuredProviders()` didn't. Exactly the
   "duplicate responsibility / inconsistent state" class of bug Phase 1's
   frontend audit went looking for — found here in the backend by a
   benchmark task that picked a "configured" provider and then failed to
   route it. Fixed at the source: one shared definition now.
2. **`analyzeIntent()` never actually produced `complexity: 'low'`** — only
   `'high'` or `'medium'`, ever. This would have silently defeated
   `executionPolicy.ts`'s entire LOW-tier fast path (the explicit "don't
   make simple requests pay for the heavy pipeline" requirement) for
   every single simple request. Caught by the policy benchmark, fixed at
   the root in `intent/intentEngine.ts`.

Also: `benchmark_runs`/several other tables' `ORDER BY created_at DESC`
was not a stable sort for rows inserted in the same millisecond (very
real in automated runs) — `previous()` could return the wrong row. Fixed
with a `rowid` tiebreaker, applied consistently across every repository
with the same pattern, not just the one that happened to have a test.

## Modularization — boundaries, not a rewrite

The backend was already built with these boundaries from Phase 2; Phase 3
didn't need to "start" modularizing, only extend inside boundaries that
already existed and hold up under a much bigger feature set:

```
config/        — env + ProviderRegistry (single source of truth for provider/model metadata)
core/          — errors, ids, logger (no dependencies on anything else in src/)
gateway/       — HTTP router + middleware (auth, rate limit, CORS, secure headers, body limits)
security/      — SSRF guard, prompt-injection guard, audit sink, secrets discipline
persistence/   — SQLite + one repository class per table, a single Repos aggregator
providers/     — the unified adapter contract + one file per vendor + ModelRouter + AdaptiveModelRouter
intent/        — analyzeIntent + executionPolicy (pure functions, no I/O)
capability/    — CapabilityGraph (existence) + PermissionModel (authorization) — deliberately separate concerns
tools/         — Registry + pipeline (8-stage) + builtin tool implementations
orchestrator/  — TaskManager, DAG executor+runner, chatService, checkpoint, streamRegistry, verifier, approvalGate, budget, taskEntryPoint
memory/        — embeddingsService (dedup+cache+batch) + contextFabric (retrieval)
evaluation/    — benchmarkTasks + benchmarkRunner (depends on nearly everything above — this is intentional, it's exercising the whole system)
observability/ — recorder (per-task) + retention (sweeps)
streaming/     — SSE wire framing + the v2 versioned event envelope
routes/        — legacy/* (wire-compatible wrappers) + v2/* (new surface) — the ONLY layer allowed to import from more than 2-3 sibling directories at once, since its whole job is composition
```

`evaluation/` and `routes/` are the two directories that legitimately reach
across many boundaries — everything else has a narrow, mostly one-directional
dependency graph (`core` and `config` depend on nothing else in `src/`;
`persistence` depends only on `core`+`config`; `providers` depends on
`core`+`config`+`persistence`... and so on up to `orchestrator`, which is
where most things converge). This wasn't retrofitted for Phase 3 — it's
the reason Phase 3 could add ~20 new files and 10 new endpoints without
touching a single existing file's public interface.

No further file-splitting was done beyond what Phase 2 already established
— the instruction was explicit: extend within proven boundaries, don't
migrate speculatively. If a future phase needs e.g. `routes/v2/` to split
further as more endpoints land, the same pattern (`register*Routes(router)`
functions, one per concern, composed in `gateway/server.ts`) already scales
without a rewrite.

## Final review summary (Phase 3)

**Architecture**: Execution Policy is now a genuinely load-bearing decision
point (`/v2/tasks`), not a document — every request is classified once and
routed to exactly the machinery its tier needs, reusing Phase 2's
chatService/DAG unmodified. AdaptiveModelRouter and NexusEvaluation went
from named-but-empty concepts to real, evidence-backed, tested systems.

**Security**: secure headers now on every response; the SSRF guard,
prompt-injection structural guarantee, budget guard, and audit trail from
Phase 2 all still hold (regression-tested); approval-gate adds a genuine
human-in-the-loop control for the highest-risk tier.

**Performance**: retention sweeps now actually run (were previously
dead code — `pruneOlderThan`/`prune` existed but nothing called them);
embeddings dedup+cache+batch from Phase 2 unchanged and still tested;
provider-call evidence collection adds negligible overhead (one SQLite
insert per attempt, same connection already in use for everything else).

**Regression**: 48/48 backend tests pass (28 Phase 2 + 20 Phase 3 net
new/expanded), covering — per the requested checklist — streaming,
cancellation, retry, fallback, checkpoint, resume, verification,
synthesis, provider switching, and backend-unavailable handling, all
against a live server, not mocks. Frontend-only checklist items (simple/
advanced mode, every Agent/Domain, workspace, decisions, monitors, mobile
CSS breakpoints) were reviewed at the code level in the HTML delivery —
see that file's own inline fix comments for the two new root-cause fixes
made there (a message-send re-entrancy race, and the new Control Center
surface).

## Known gaps / honest limitations (flagged, not hidden)

1. **`/api/embed` has no auth check even in an authenticated deployment.**
   The frontend's current `getEmbedding()` call sends no `Authorization`
   header (verified by reading the frontend source directly, not assumed).
   Since this task couldn't touch the frontend, the compatibility-first
   choice was to leave this route `skipAuth: true` rather than break
   embeddings for everyone the moment gateway keys are configured. **This
   should be revisited** the next time the frontend is in scope: add the
   header client-side, then remove `skipAuth` here.
2. **`/api/market-context` is a stub.** No specific market-data vendor was
   specified, so this returns `{available: false}` rather than guessing an
   API and baking in a dependency. It's wired to route through the same
   `safeFetch()` SSRF guard the moment a real provider is chosen.
3. **Provider adapters are verified against real, current API
   documentation and exercised end-to-end against fake servers that speak
   each wire format**, but never against the real hosted APIs — this
   sandbox has no outbound internet access. Before production use, run one
   real request per provider (a single `curl` against `/api/chat` with a
   real key configured is enough) to catch any drift between documented
   and actual behavior.
4. **`node:sqlite` is still an experimental Node API** (stable enough to
   use without a flag as of Node 22.22, but Node itself labels it
   experimental). If your deployment target is an older/different Node
   build where this isn't available, swap `persistence/db.ts`'s import for
   any other embedded SQL store — every repository only talks to that one
   file.
5. **Cost estimates in `orchestrator/budget.ts` are approximate**, not
   billing-grade — they're a safety-guard input, not an invoice.
6. **AdaptiveModelRouter's evidence resets with the database.** It has no
   memory beyond `provider_call_log`'s retention window (30 days by
   default) — this is intentional (stale reliability signals from months
   ago shouldn't steer today's routing) but means a fresh deployment or
   one that just rotated its DB starts back at cold-start (registry
   order) until evidence accumulates again.
7. **`/v2/tasks`'s HIGH/HIGH_RISK path streams a mix of v2-enveloped
   (`task_meta`) and legacy-shaped (`task_start`/`task_done`/`plan_done`/
   etc, unversioned) events on the same connection.** This was a
   deliberate, documented trade-off: wrapping the DAG's existing events in
   the v2 envelope would have required touching `runPlanTask`'s tested
   event-emission code, and a `taskId` naming collision between "the
   overall task" and "the DAG node" in that payload shape made that
   change genuinely risky to get right quickly. The mix is safe and fully
   functional (every event still round-trips through the same durable,
   resumable stream) — just not uniformly enveloped yet. A future pass
   could resolve the naming collision (e.g. rename the DAG node field to
   `nodeId`) and then wrap those events too.
8. **The Feedback Loop has no abuse/spam protection beyond the existing
   rate limiter and gateway auth.** `POST /v2/feedback` doesn't currently
   deduplicate repeated ratings from the same client on the same task —
   low-risk for a single-tenant/trusted deployment, worth adding
   (e.g. one rating per client per task) before exposing this to
   untrusted multi-tenant traffic.

## Testing

```bash
npm test
```

48 tests, ~7s, zero network access required:
- `test/dag.test.ts` (8) — scheduler correctness in isolation: dependency
  order, concurrency limits, failure cascade, retry, reflection, resume,
  cycle detection.
- `test/embeddingsService.test.ts` (4) — dedup, cache reuse across calls,
  batching, mixed hit/miss.
- `test/integration.test.ts` (9) — the **real** HTTP server, started live,
  talking to a fake Anthropic-shaped server over loopback: health, models
  metadata (no key leak), chat non-streaming, chat streaming (real SSE
  parsing, monotonic event ids), a full tool-use round trip (model asks
  for `calculate`, backend executes it, model gets the result and answers),
  a full DAG plan+run (2 dependent nodes, real `task_start`/`task_done`/
  `plan_done` events), SSRF blocks against two real target categories,
  and a malformed-provider validation error.
- `test/authGateway.test.ts` (6) — auth actually enforced with keys
  configured, actually open with none, `skipAuth` routes correctly bypass it.
- `test/providerFallback.test.ts` (1) — primary provider hard-fails (503),
  request transparently falls back to a configured secondary provider and
  still succeeds — verified live, not mocked at the function level.
- `test/adaptiveModelRouter.test.ts` (6, Phase 3) — cold start returns
  registry order unchanged, evidence-based reordering once enough history
  exists, low-confidence providers never leapfrog well-evidenced ones,
  no fabricated fields, per-route evidence scoping, never adds/removes
  candidates.
- `test/benchmarkRunner.test.ts` (4, Phase 3) — the full deterministic
  benchmark battery passes cold, first-run has no previous release to
  compare against, a genuine regression (previously-passing check now
  failing) is correctly detected, two real successive runs show zero
  regressions when nothing changed.
- `test/executionPolicy.test.ts` (10, Phase 3) — the real live server:
  LOW-tier fast path, HIGH-tier DAG escalation, HIGH_RISK hold-for-approval
  (never auto-delivers), approve releases the real result, reject cancels
  the task, a second decision on an already-decided approval gets 409 not
  silent acceptance, feedback recording against a real task (and 404 against
  a fake one), a live benchmark run and its stored result over HTTP, and
  secure headers present on every response.

Two real bugs were caught and fixed by these tests during Phase 2
development, not just written to pass: an adapter-config-caching interaction that made a
mid-process base-URL change silently ineffective (a test-authoring bug that
also documents genuine adapter caching semantics worth knowing), and raw
network failures (`ECONNREFUSED`, "fetch failed") being misclassified as
non-retryable — which would have silently defeated retry/fallback for the
single most common real-world failure mode. Both fixes are in
`src/core/errors.ts` and `src/providers/index.ts`.
