/**
 * NEXUS VEL (Verified Execution Layer) — contract types for tools that have an EXTERNAL EFFECT.
 *
 * A tool opts into VEL by declaring `RegisteredTool.effect` (see registry.ts). Tools that do not declare it (web_fetch, calculate,
 * code_execution when explicitly registered; it is NOT registered by default since G8.1) keep the exact pre-VEL path in pipeline.ts — VEL is deliberately NOT forced onto existing connectors.
 *
 * The three rules this contract exists to enforce:
 *   1. An effectful tool has NO `execute()` — the only way to cause its effect is `effect.dispatch()`, which pipeline.ts calls only
 *      after a policy decision and a write-ahead receipt. (Anyone who imports the connector module directly can still call dispatch();
 *      that is a code-review boundary, not a runtime one — see the VEL report, "Known Limitations".)
 *   2. "Did it work?" is answered by `effect.observe()`, a SEPARATE read path against the target system. dispatch()'s own return value
 *      is only the connector's CLAIM and is never, by itself, proof (and is never passed to observe()).
 *   3. A failure is classified honestly: `EffectDispatchError{definite:true}` means "the connector guarantees nothing was applied";
 *      anything else (timeout, network error, unknown exception) is AMBIGUOUS — the effect may or may not have happened.
 */

/** Non-secret identifiers, computed from the validated input, that let observe() find the effect later WITHOUT the raw input (stored on the receipt, so recovery after a restart does not need — and the receipt never holds — the raw parameters). */
export type EffectLocator = Record<string, string | number | boolean>;

export interface EffectCallContext {
  /** The receipt id; stable across attempts of one action. */
  actionId: string;
  /** Unique per dispatch attempt. */
  attemptId: string;
  /** 1-based. */
  attempt: number;
  /** Stable across attempts AND across replays of the same (task, tool, resource, params). A connector that honors it can make a repeated dispatch a no-op. */
  idempotencyKey: string;
  taskId: string;
  /** Aborted when the dispatch/observe timeout fires. Best-effort: aborting does NOT prove the effect did not happen. */
  signal: AbortSignal;
}

export interface EffectAck {
  ok: true;
  /** Connector-side reference (record id etc.) — descriptive only. */
  reference?: string;
}

export type EffectObservation =
  | { readable: false; reason: string }
  | {
      readable: true;
      /** Number of records in the target system that satisfy the declared success condition for this action. */
      matches: number;
      /** Number of records that exist at the same locator but VIOLATE the success condition (e.g. same id, different content). */
      conflicts: number;
    };

export class EffectDispatchError extends Error {
  /** true ONLY when the connector can guarantee that nothing was applied (e.g. a rejected request). Default for any other throw is ambiguous. */
  readonly definite: boolean;
  constructor(message: string, definite: boolean) {
    super(message);
    this.name = 'EffectDispatchError';
    this.definite = definite;
  }
}

export interface ToolEffectSpec {
  /** Connector name, e.g. "billing-api". Recorded on the receipt. */
  connector: string;
  /** Operation name, e.g. "ledger.append". Recorded on the receipt. */
  operation: string;
  /** Target resource identifier (policy scope is matched against it). Must be a short, non-secret string. */
  resource(input: Record<string, unknown>): string;
  /** Redacted, human-readable one-line summary of the parameters. MUST NOT contain secrets — it is persisted. */
  summarize(input: Record<string, unknown>): string;
  /** Non-secret locator for observe(); persisted on the receipt. */
  locator(input: Record<string, unknown>): EffectLocator;
  /** The success condition, declared in advance (persisted verbatim on the receipt). */
  successCondition: string;
  /** 'key_supported' = the connector/target dedupes by EffectCallContext.idempotencyKey (a repeated dispatch cannot double-apply). 'none' = no such guarantee: an ambiguous failure is NEVER retried automatically. */
  idempotency: 'key_supported' | 'none';
  /** Hard bounds. maxAttempts >= 1. Retries happen only when provably safe (see verifiedExecution.ts). */
  maxAttempts: number;
  dispatchTimeoutMs: number;
  observeTimeoutMs: number;
  /** Wall-clock budget across all attempts of one action. */
  totalBudgetMs: number;
  dispatch(input: Record<string, unknown>, call: EffectCallContext): Promise<EffectAck>;
  /** Independent read of the target system's actual state. Must not depend on dispatch()'s return value. */
  observe(locator: EffectLocator, call: EffectCallContext): Promise<EffectObservation>;
}

/**
 * NEXUS VEL gap G8 — explicit effect classification for every tool that keeps a plain `execute()`.
 *
 * A tool is either (a) effectful and declares `effect` (VEL-gated, no execute), or (b) keeps `execute()` and MUST state, at registration, why that is
 * acceptable. ToolRegistry.register() rejects a tool with `execute` and no classification, so "forgot to think about external effects" can no longer
 * happen silently. This is an AUDITABLE ATTESTATION, not a proof: nothing here can verify the claim is true. Its value is that the claim exists,
 * is reviewable in one place, and (for `legacy_exempt`) is pinned by a test so adding an exemption is a visible, deliberate change.
 *
 *  - 'pure'          : no I/O of any kind (computation on the input only).
 *  - 'read_only'     : reads from outside but has no intended write/mutation path (e.g. an HTTP GET). Remote side effects of a GET we do not control are not covered.
 *  - 'legacy_exempt' : CAN cause external effects but is NOT VEL-gated (pre-VEL tool). Requires the compensating controls to be named. Never use for new tools.
 */
export type EffectClassification =
  | { kind: 'pure' | 'read_only'; reason: string }
  | { kind: 'legacy_exempt'; reason: string; compensatingControls: string };
