# ADR (number unassigned) — NEXUS VEL: Verified Execution Layer for effectful tools

**Status**: PROPOSED — not approved. This record deliberately takes **no ADR number**: ADR-006 is referenced by the owner's directive as PROPOSED but is **not present** in the source available to this session (`ADR/` ends at 005), so its content and any overlap with this proposal could not be examined. The owner assigns the number and decides acceptance.
**Date**: 2026-10-21
**Scope**: tools that DECLARE an external effect (`RegisteredTool.effect`). Existing tools are unchanged.

## Context
`tools/pipeline.ts` checked capability, budget and schema, ran `execute()` under a timeout, and returned text. Confirmed from code: (1) a tool timeout was reported as an ordinary failure although `execute()` is never aborted and the effect may complete later; (2) nothing durable recorded an allowed call, its policy decision, or its outcome; (3) no task identity reached the pipeline; (4) nothing read the target system to check a claimed success; (5) a replayed mission re-plans and re-issues tool calls with fresh `tool_use` ids, so an effectful call could repeat. No built-in tool has an external write today, so none of this was exploitable yet — it would have been the first thing exploited by the first such connector.

## Proposal
1. **Opt-in effect contract** (`tools/effectTypes.ts`): effectful tools have no `execute()`; only `dispatch()` + an independent `observe()`.
2. **Default-deny policy at the point of execution** (`tools/effectPolicy.ts`), re-evaluated on every attempt; inputs are canonicalised once and the same object is checked and dispatched; policy version (digest of active rules) is recorded.
3. **Write-ahead durable receipt** (`execution_receipts`, migration 017, additive): no receipt ⇒ no dispatch.
4. **Honest failure classes**: definite-no-effect vs ambiguous; ambiguity is reconciled by reading the target, never by blind retry; automatic retry only if absence is confirmed AND the connector honors the idempotency key AND attempts/time budget remain.
5. **Race-safe duplicate prevention** via a partial unique index on a task-scoped dedupe key.
6. **Evidence semantics, scoped to execution receipts**: `verification` reuses the five existing states. `VERIFIED` here means *the predeclared success condition held in an independent read-back of the target* (an `ENVIRONMENTAL_OBSERVATION` in ADR-004 terms) with no contradictory observation. The connector's own reply is a `TOOL_RESULT`-like claim and never suffices. A claimed success contradicted by the read-back is `CONFLICTING`. This does **not** change `EvaluationEngine` or its judge-based meaning of `VERIFIED` (ADR-004). **Owner decision requested**: confirm this scoped meaning, or require a stricter bar.

## Consequences
- New table, 3 read routes, startup recovery hook, one added argument on `executeToolCall(s)` (`opts.taskId`), one extra argument at the single `chatService` call site.
- One existing test assertion re-targeted (AC-7 "016 is the last migration" → "nothing after 016 touches `claim_evaluations`"); all other assertions of that test unchanged.
- A same-task identical action is suppressed while a non-released receipt exists; an agent that truly wants two identical effects must make them distinct (e.g. distinct entry id).

## Limits (not solved)
Connector honesty and true independence of `observe()` from the connector's own backend; exactly-once delivery; tamper-evidence of the receipt table (ordinary mutable table); multi-process deployments (recovery assumes one process); per-action human approval; effectful paths outside the tool pipeline (IoT push, fine-tuning upload, web research, legacy fetch route); (G8, 2026-10-21: partially addressed — registration now REQUIRES an explicit `effectClass` attestation for any `execute()` tool and rejects `effect`+`execute`; it still cannot verify that an attestation is TRUE, and `code_execution` is pinned as `legacy_exempt`, not VEL-gated); UI does not yet render these states.

## Alternatives considered
- Wrapping every existing tool in VEL — rejected: would silently change verified behavior of `web_fetch`/`calculate`/`code_execution` (out of slice).
- Kill switch that falls back to ungated execution — rejected: a disabled safety control must fail closed.
- Storing raw parameters to ease reconciliation — rejected: secrets risk; a non-secret `locator` is stored instead.
- New evidence states (e.g. `OUTCOME_UNKNOWN` as a verdict) — rejected: would change the meaning of the existing taxonomy; `OUTCOME_UNKNOWN` is a lifecycle `status`, kept separate.

## Addendum — G8 (2026-10-21, still PROPOSED)
Registration-time gate in `tools/registry.ts`: `execute` tools must carry `effectClass` {pure | read_only | legacy_exempt(+compensatingControls)}; `effect`+`execute` and `effect`+`effectClass` are rejected; stored entries are frozen copies. The exemption list is pinned by test. Honest limit: an attestation, not a proof; direct calls to a connector's own functions remain a code-review boundary. Open owner question: should `code_execution` (no FS/network isolation) be routed through VEL, kept `legacy_exempt`, or removed from default registration?

## Addendum — G8.1 (2026-10-21, still PROPOSED)
Owner decision OPTION C: `code_execution` is removed from default registration (implementation kept). It stays disabled until an isolated execution environment exists, the tool is bound to the VEL gate, and its security/recovery tests pass. This removes default availability only; it adds no isolation and makes no safety claim about code execution.
