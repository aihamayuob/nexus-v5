import { createHash, randomUUID } from 'node:crypto';
import type { ProviderId } from '../config/providerRegistry.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { PermissionModel } from '../capability/permissionModel.js';
import { getRepos } from '../persistence/repos.js';
import type { ExecutionReceipt, ReceiptStatus, ReceiptVerification, NewReceipt } from '../persistence/repositories/executionReceiptRepo.js';
import { validateAgainstSchema, getToolRegistry, type RegisteredTool } from './registry.js';
import { decideEffectPolicy, isSafeResource, policyVersion, type EffectPolicyDecision } from './effectPolicy.js';
import { EffectDispatchError, type EffectCallContext, type EffectObservation, type ToolEffectSpec } from './effectTypes.js';
import { auditSecurityEvent } from '../security/audit.js';
import { normalizeError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { ToolCallRequest, ToolCallResult } from './pipeline.js';

/**
 * NEXUS VEL — the Verified Execution Layer for tools that declare an external effect (tools/effectTypes.ts).
 *
 *   Authorized Request -> Policy Decision -> Controlled Action -> Independent Verification -> Durable Evidence -> Safe Recovery
 *
 * Invariants this file implements (each is covered by a test in test/verifiedExecution*.test.ts):
 *   - No dispatch before (a) an allow decision and (b) a durable IN_FLIGHT receipt exists. If the receipt cannot be written, the action is NOT executed.
 *   - The connector's own reply is a CLAIM. VERIFIED requires an independent read-back (effect.observe) showing the predeclared success condition.
 *   - A timeout / lost reply / unknown exception is AMBIGUOUS: the action is never retried "blindly". It is reconciled by reading the target state;
 *     an automatic retry happens only when absence is confirmed AND the connector honors the idempotency key AND attempts/time budget remain.
 *   - An identical action (same task, tool, resource, params) cannot run twice while a non-released receipt exists (DB unique index => race-safe).
 *   - Evidence of different actions/tasks never mixes: every receipt, observation and result is keyed by its own actionId/attemptId.
 *
 * What this does NOT prove (see report): connector honesty, true independence of the observe path from the connector's own backend, exactly-once
 * delivery, or tamper-resistance of the receipt table.
 */

const PROOF_LIMITS =
  'Verification is a deterministic read-back via the connector\'s observe() — a read path separate from dispatch() but implemented by the same connector; it is not cryptographic, not tamper-evident, and does not prove exactly-once delivery.';

export type ObservationKind = 'applied' | 'absent' | 'duplicate' | 'conflict' | 'unreadable';

export function interpretObservation(o: EffectObservation): ObservationKind {
  if (!o.readable) return 'unreadable';
  if (o.conflicts > 0) return 'conflict';
  if (o.matches === 1) return 'applied';
  if (o.matches === 0) return 'absent';
  return 'duplicate';
}

export interface OutcomeDecision {
  status: ReceiptStatus;
  verification: ReceiptVerification | null;
  basis: string;
  needsHumanReason: string | null;
  /** Absence was confirmed AND re-dispatching with the same idempotency key cannot double-apply. */
  retrySafe: boolean;
}

/** Pure decision table: (did the connector acknowledge?) x (what the independent read-back showed) x (idempotency support). Exported for direct unit testing. */
export function decideOutcome(hasAck: boolean, kind: ObservationKind, idempotency: ToolEffectSpec['idempotency']): OutcomeDecision {
  if (hasAck) {
    switch (kind) {
      case 'applied':
        return { status: 'ACKED', verification: 'VERIFIED', basis: 'independent_readback:applied_once', needsHumanReason: null, retrySafe: false };
      case 'absent':
        return { status: 'ACKED', verification: 'CONFLICTING', basis: 'connector_claimed_success_but_readback_shows_no_effect', needsHumanReason: 'connector_acked_but_effect_absent', retrySafe: false };
      case 'duplicate':
        return { status: 'ACKED', verification: 'CONFLICTING', basis: 'readback_shows_more_than_one_effect', needsHumanReason: 'duplicate_effect_observed', retrySafe: false };
      case 'conflict':
        return { status: 'ACKED', verification: 'CONFLICTING', basis: 'readback_shows_state_violating_success_condition', needsHumanReason: 'conflicting_state_observed', retrySafe: false };
      case 'unreadable':
        return { status: 'ACKED', verification: 'UNCERTAIN', basis: 'connector_claim_only_readback_unavailable', needsHumanReason: null, retrySafe: false };
    }
  }
  switch (kind) {
    case 'applied':
      return { status: 'RECONCILED_APPLIED', verification: 'VERIFIED', basis: 'independent_readback:applied_once_ack_lost', needsHumanReason: null, retrySafe: false };
    case 'absent':
      return idempotency === 'key_supported'
        ? { status: 'RECONCILED_NOT_APPLIED', verification: null, basis: 'independent_readback:absent', needsHumanReason: null, retrySafe: true }
        : { status: 'OUTCOME_UNKNOWN', verification: 'UNCERTAIN', basis: 'absent_in_readback_but_not_conclusive_without_idempotency', needsHumanReason: 'absence_not_conclusive_without_idempotency', retrySafe: false };
    case 'duplicate':
      return { status: 'OUTCOME_UNKNOWN', verification: 'CONFLICTING', basis: 'readback_shows_more_than_one_effect', needsHumanReason: 'duplicate_effect_observed', retrySafe: false };
    case 'conflict':
      return { status: 'OUTCOME_UNKNOWN', verification: 'CONFLICTING', basis: 'readback_shows_state_violating_success_condition', needsHumanReason: 'conflicting_state_observed', retrySafe: false };
    case 'unreadable':
      return { status: 'OUTCOME_UNKNOWN', verification: 'UNVERIFIED', basis: 'target_state_unreadable', needsHumanReason: 'target_state_unreadable', retrySafe: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

class VelTimeout extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`);
    this.name = 'VelTimeout';
  }
}

async function runBounded<T>(what: string, ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const p = (async () => fn(ac.signal))();
  p.catch(() => {
    /* a late settle after the timeout must never become an unhandled rejection */
  });
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new VelTimeout(what, ms));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, walk((v as Record<string, unknown>)[k])])
      );
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function describe(r: ExecutionReceipt): { content: string; isError: boolean } {
  const tag = `[VEL إيصال=${r.id} الحالة=${r.status}${r.verification ? ` التحقق=${r.verification}` : ''}]`;
  const human = r.needsHuman ? ' يتطلب مراجعة بشرية.' : '';
  switch (r.status) {
    case 'DENIED':
      return { content: `${tag} رُفضت العملية بقرار السياسة (${r.policyReason}). لم يقع أي أثر.`, isError: true };
    case 'FAILED':
      return { content: `${tag} فشلت العملية ولم يقع أي أثر (أكّد الموصل أنه لم يطبّق شيئاً).`, isError: true };
    case 'RECONCILED_NOT_APPLIED':
      return { content: `${tag} لم يقع الأثر: أكدت قراءة مستقلة غيابه.`, isError: true };
    case 'RECONCILED_APPLIED':
      return { content: `${tag} فُقد رد الموصل لكن قراءة مستقلة أكدت وقوع الأثر مرة واحدة. لا تكرر الطلب.`, isError: false };
    case 'IN_FLIGHT':
      return { content: `${tag} العملية قيد التنفيذ ولم تُحسم بعد. لا تكرر الطلب.`, isError: true };
    case 'OUTCOME_UNKNOWN':
      return { content: `${tag} نتيجة العملية غير معروفة (قد يكون الأثر وقع أو لا). لم تُكرَّر تلقائياً. لا تُبلغ المستخدم بنجاح ولا تكرر الطلب.${human}`, isError: true };
    case 'ACKED':
      if (r.verification === 'VERIFIED') return { content: `${tag} نُفّذت العملية وتأكد أثرها بقراءة مستقلة لحالة النظام الهدف.`, isError: false };
      if (r.verification === 'CONFLICTING') {
        return { content: `${tag} أبلغ الموصل بالنجاح لكن الحالة الفعلية في النظام الهدف تتعارض مع ذلك. لا تعتبر العملية ناجحة ولا تكررها.${human}`, isError: true };
      }
      return { content: `${tag} أبلغ الموصل بالنجاح لكن تعذّر التحقق المستقل من الأثر. لا تعتبر العملية ناجحة مؤكدة ولا تكررها.${human}`, isError: true };
  }
}

function toResult(id: string, r: ExecutionReceipt, prefix = ''): ToolCallResult {
  const d = describe(r);
  return { id, content: prefix + d.content, isError: d.isError, receipt: { id: r.id, status: r.status, verification: r.verification, needsHuman: r.needsHuman } };
}

function plainError(id: string, content: string): ToolCallResult {
  return { id, content, isError: true };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------

export interface VelCallOptions {
  taskId?: string | null;
}

export async function executeEffectfulToolCall(
  req: ToolCallRequest,
  providerId: ProviderId,
  ctx: GatewayContext,
  tool: RegisteredTool & { effect: ToolEffectSpec },
  opts: VelCallOptions = {}
): Promise<ToolCallResult> {
  const effect = tool.effect;
  const toolName = tool.def.name;
  const taskId = opts.taskId ?? null;
  const repo = getRepos().executionReceipts;
  const startedAt = Date.now();
  const actionId = randomUUID();

  // 0. Canonicalise ONCE. The exact object checked by policy/validation is the exact object dispatched (no TOCTOU between check and use).
  let canon: string;
  let input: Record<string, unknown>;
  try {
    canon = canonicalJson(req.input);
    input = Object.freeze(JSON.parse(canon)) as Record<string, unknown>;
  } catch {
    return plainError(req.id, 'مدخل الأداة غير صالح للتسلسل — لم يُنفَّذ شيء.');
  }
  const paramsDigest = sha256(canon);

  let resource = '';
  try {
    const r = effect.resource(input);
    resource = isSafeResource(r) ? r : '';
  } catch {
    resource = '';
  }
  const dedupeKey = sha256(`${taskId ?? ''}|${toolName}|${resource}|${paramsDigest}`);
  const idempotencyKey = `nxvel-${dedupeKey.slice(0, 40)}`;

  const base = (policy: EffectPolicyDecision, status: ReceiptStatus): NewReceipt => ({
    id: actionId,
    taskId,
    toolName,
    toolUseId: req.id,
    connector: effect.connector,
    operation: effect.operation,
    resource: resource || null,
    paramsDigest,
    paramsSummary: safeSummary(effect, input),
    locator: null,
    dedupeKey,
    idempotencyKey,
    idempotencyMode: effect.idempotency,
    actorRef: ctx.clientKey,
    projectId: ctx.projectId,
    userId: ctx.userId,
    providerId,
    policyVersion: policy.policyVersion,
    policyDecision: policy.allow ? 'allow' : 'deny',
    policyRuleId: policy.ruleId,
    policyReason: policy.reason,
    successCondition: effect.successCondition,
    status,
    proofLimits: PROOF_LIMITS,
    startedAt,
  });

  const deny = (policy: EffectPolicyDecision): ToolCallResult => {
    const rec: NewReceipt = { ...base(policy, 'DENIED'), finishedAt: Date.now() };
    auditSecurityEvent('warn', 'VEL: effectful action denied', { toolName, reason: policy.reason, ruleId: policy.ruleId, policyVersion: policy.policyVersion, taskId, actionId });
    try {
      repo.insert(rec, { at: Date.now(), type: 'denied', detail: policy.reason });
      return toResult(req.id, repo.get(actionId)!);
    } catch (e) {
      // A denial needs no durable record to be SAFE (nothing ran). Still say so honestly.
      logger.error('VEL: could not persist a DENIED receipt', { actionId, message: (e as Error).message });
      return plainError(req.id, `[VEL] رُفضت العملية بقرار السياسة (${policy.reason}). لم يقع أي أثر. (تعذّر حفظ إيصال الرفض)`);
    }
  };

  // 1. Capability + budget (the pre-VEL checks, unchanged) — a refusal here is also receipted.
  try {
    PermissionModel.assertToolAllowed(providerId, toolName, ctx);
    PermissionModel.assertBudgetAllowed();
  } catch (e) {
    return deny({ allow: false, reason: `capability_or_budget:${normalizeError(e).code}`, ruleId: null, policyVersion: policyVersion() });
  }

  // 2. Policy decision at the point of execution.
  const decision = decideEffectPolicy({ toolName, resource, taskId, gw: ctx });
  if (!decision.allow) return deny(decision);

  // 3. Input validation (after policy so a denied caller learns nothing about the schema; before any effect).
  const schemaErrors = validateAgainstSchema(tool.def.input_schema, input);
  let locator: ReturnType<ToolEffectSpec['locator']> | null = null;
  if (schemaErrors.length === 0) {
    try {
      locator = effect.locator(input);
    } catch {
      schemaErrors.push('تعذّر اشتقاق محدد الأثر من المدخلات.');
    }
  }
  if (schemaErrors.length > 0) {
    const rec: NewReceipt = { ...base(decision, 'FAILED'), finishedAt: Date.now() };
    try {
      repo.insert(rec, { at: Date.now(), type: 'validation_failed', detail: schemaErrors.join(' ').slice(0, 300) });
    } catch {
      /* nothing ran; the refusal below is accurate even without a record */
    }
    return plainError(req.id, `[VEL] مدخلات غير صالحة — لم يقع أي أثر: ${schemaErrors.join(' ')}`);
  }

  // 4. Write-ahead receipt. Fail closed: "not documented => not executed".
  let claim: { ok: true } | { ok: false };
  try {
    claim = repo.insert({ ...base(decision, 'IN_FLIGHT'), locator }, { at: Date.now(), type: 'claimed', detail: `policy=${decision.policyVersion} rule=${decision.ruleId}` });
  } catch (e) {
    auditSecurityEvent('critical', 'VEL: receipt storage failed BEFORE dispatch — action not executed', { toolName, taskId, actionId });
    logger.error('VEL: receipt storage failed before dispatch', { actionId, message: (e as Error).message });
    return plainError(req.id, '[VEL] تعذّر حفظ سجل التنفيذ، فلم تُنفَّذ العملية (لا تنفيذ بلا توثيق). لم يقع أي أثر.');
  }
  if (!claim.ok) {
    const existing = repo.findActiveByDedupe(dedupeKey);
    logger.warn('VEL: duplicate action suppressed', { toolName, taskId, existing: existing?.id });
    if (!existing) return plainError(req.id, '[VEL] طلب مطابق قيد المعالجة — لم يُكرَّر. أعد الاستعلام لاحقاً.');
    return toResult(req.id, existing, '[مكرر — لم يُنفَّذ مرة أخرى] ');
  }

  // 5. Attempt loop (bounded by maxAttempts and totalBudgetMs).
  let persistFailed = false;
  const safe = (fn: () => ExecutionReceipt): ExecutionReceipt | null => {
    try {
      return fn();
    } catch (e) {
      persistFailed = true;
      auditSecurityEvent('critical', 'VEL: receipt update failed AFTER dispatch — outcome is NOT documented', { toolName, taskId, actionId });
      logger.error('VEL: receipt update failed after dispatch', { actionId, message: (e as Error).message });
      return null;
    }
  };
  const callCtx = (attemptId: string, attempt: number, signal: AbortSignal): EffectCallContext => ({ actionId, attemptId, attempt, idempotencyKey, taskId: taskId!, signal });

  let last: ExecutionReceipt | null = null;
  // Outcome to record if the NEXT attempt is not allowed to start (budget/policy) — so an action is never left IN_FLIGHT by a skipped retry.
  let carry: Parameters<typeof repo.transition>[1] | null = null;
  const maxAttempts = Math.max(1, Math.floor(effect.maxAttempts));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      if (Date.now() - startedAt >= effect.totalBudgetMs) {
        last = safe(() => repo.transition(actionId, carry ?? {}, { at: Date.now(), type: 'retry_skipped', detail: 'total_budget_exhausted' }));
        break;
      }
      const again = decideEffectPolicy({ toolName, resource, taskId, gw: ctx, isRetry: true });
      if (!again.allow) {
        last = safe(() => repo.transition(actionId, carry ?? {}, { at: Date.now(), type: 'retry_denied_by_policy', detail: again.reason }));
        break;
      }
    }
    const attemptId = randomUUID();
    // Attempt start is persisted BEFORE dispatch; if that fails nothing is dispatched for this attempt.
    try {
      last = repo.transition(actionId, { status: 'IN_FLIGHT', attemptCount: attempt, lastAttemptId: attemptId }, { at: Date.now(), type: 'attempt_started', attemptId });
    } catch (e) {
      auditSecurityEvent('critical', 'VEL: receipt storage failed before attempt — attempt not dispatched', { toolName, taskId, actionId, attempt });
      logger.error('VEL: attempt-start persistence failed', { actionId, message: (e as Error).message });
      return plainError(req.id, `[VEL إيصال=${actionId}] تعذّر حفظ سجل المحاولة ${attempt}، فلم تُرسَل. ${attempt > 1 ? 'المحاولة السابقة غير محسومة.' : 'لم يقع أي أثر.'}`);
    }

    let ack = false;
    let definiteMsg: string | null = null;
    let ambiguousMsg: string | null = null;
    try {
      await runBounded('dispatch', effect.dispatchTimeoutMs, (signal) => effect.dispatch(input, callCtx(attemptId, attempt, signal)));
      ack = true;
    } catch (e) {
      if (e instanceof EffectDispatchError && e.definite) definiteMsg = e.message;
      else ambiguousMsg = e instanceof VelTimeout ? e.message : `ambiguous failure: ${(e as Error)?.name ?? 'Error'}`;
    }

    if (definiteMsg !== null) {
      const canRetry = attempt < maxAttempts;
      last = safe(() =>
        repo.transition(
          actionId,
          canRetry ? {} : { status: 'FAILED', finishedAt: Date.now() },
          { at: Date.now(), type: 'dispatch_failed_definite', attemptId, detail: definiteMsg!.slice(0, 200) }
        )
      );
      if (canRetry) {
        carry = { status: 'FAILED', finishedAt: Date.now() };
        continue; // provably no effect => a retry cannot duplicate anything
      }
      break;
    }

    // Ack or ambiguous: BOTH go through an independent read-back. Ack alone never proves anything.
    if (ack) last = safe(() => repo.transition(actionId, { status: 'ACKED' }, { at: Date.now(), type: 'dispatch_acked', attemptId }));
    else last = safe(() => repo.transition(actionId, { status: 'OUTCOME_UNKNOWN' }, { at: Date.now(), type: 'dispatch_ambiguous', attemptId, detail: ambiguousMsg!.slice(0, 200) }));

    const kind = await observeKind(effect, locator!, callCtx(randomUUID(), attempt, new AbortController().signal));
    const outcome = decideOutcome(ack, kind, effect.idempotency);
    const willRetry = !ack && outcome.retrySafe && attempt < maxAttempts && Date.now() - startedAt < effect.totalBudgetMs;
    if (willRetry) {
      // Absence confirmed + idempotent connector: keep the receipt active (OUTCOME_UNKNOWN) and go around again with the SAME idempotency key.
      last = safe(() => repo.transition(actionId, {}, { at: Date.now(), type: 'readback_absent_retrying', attemptId, detail: 'idempotent retry' }));
      carry = { status: 'RECONCILED_NOT_APPLIED', verification: null, verificationBasis: 'independent_readback:absent', needsHuman: false, needsHumanReason: null, finishedAt: Date.now() };
      continue;
    }
    last = safe(() =>
      repo.transition(
        actionId,
        {
          status: outcome.status,
          verification: outcome.verification,
          verificationBasis: outcome.basis,
          needsHuman: outcome.needsHumanReason !== null,
          needsHumanReason: outcome.needsHumanReason,
          finishedAt: outcome.status === 'OUTCOME_UNKNOWN' ? null : Date.now(),
        },
        { at: Date.now(), type: ack ? 'verified_after_ack' : 'reconciled_after_ambiguity', attemptId, detail: `${kind} => ${outcome.status}/${outcome.verification ?? '-'}` }
      )
    );
    break;
  }

  const final = repo.get(actionId) ?? last;
  if (!final) return plainError(req.id, `[VEL إيصال=${actionId}] حالة العملية غير معروفة وتعذّر قراءة سجلها.`);
  if (final.needsHuman) auditSecurityEvent('warn', 'VEL: action needs human review', { toolName, taskId, actionId, reason: final.needsHumanReason });
  if (persistFailed) {
    return {
      id: req.id,
      isError: true,
      content: `[VEL إيصال=${actionId}] تعذّر توثيق نتيجة العملية بعد إرسالها — النتيجة غير موثّقة ولا تُعتبر ناجحة. سيُعاد حسمها من حالة النظام الهدف عند الاسترداد. لا تكرر الطلب.`,
      receipt: { id: actionId, status: final.status, verification: final.verification, needsHuman: final.needsHuman },
    };
  }
  logger.info('VEL action finished', { toolName, actionId, status: final.status, verification: final.verification, attempts: final.attemptCount });
  return toResult(req.id, final);
}

function safeSummary(effect: ToolEffectSpec, input: Record<string, unknown>): string | null {
  try {
    return effect.summarize(input).slice(0, 300);
  } catch {
    return null;
  }
}

async function observeKind(effect: ToolEffectSpec, locator: NonNullable<ReturnType<ToolEffectSpec['locator']>>, call: EffectCallContext): Promise<ObservationKind> {
  try {
    const obs = await runBounded('observe', effect.observeTimeoutMs, (signal) => effect.observe(locator, { ...call, signal }));
    return interpretObservation(obs);
  } catch {
    return 'unreadable';
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Recovery / reconciliation. Never re-dispatches: it only READS the target state and records what is true.

/**
 * Re-reads the target state for a receipt that is OUTCOME_UNKNOWN, or ACKED but not VERIFIED, and records the result. Safe to call repeatedly.
 * Returns the (possibly unchanged) receipt, or null if it does not exist / its connector is no longer registered.
 */
export async function reconcileReceipt(receiptId: string): Promise<ExecutionReceipt | null> {
  const repo = getRepos().executionReceipts;
  const r = repo.get(receiptId);
  if (!r) return null;
  const effect = getToolRegistry().get(r.toolName)?.effect;
  const unresolved = r.status === 'OUTCOME_UNKNOWN' || (r.status === 'ACKED' && r.verification !== 'VERIFIED');
  if (!unresolved) return r;
  if (!effect || !r.locator) {
    return repo.transition(receiptId, { needsHuman: true, needsHumanReason: 'connector_not_registered_or_no_locator' }, { at: Date.now(), type: 'reconcile_impossible' });
  }
  const hasAck = r.status === 'ACKED';
  const kind = await observeKind(effect, r.locator, { actionId: r.id, attemptId: randomUUID(), attempt: r.attemptCount, idempotencyKey: r.idempotencyKey ?? '', taskId: r.taskId ?? '', signal: new AbortController().signal });
  // Conservative: "a retry is idempotent" must hold for what the dispatch actually ran under (receipt) AND for the connector as declared now.
  const idem: ToolEffectSpec['idempotency'] = r.idempotencyMode === 'key_supported' && effect.idempotency === 'key_supported' ? 'key_supported' : 'none';
  const outcome = decideOutcome(hasAck, kind, idem);
  // Never downgrade an already-better verification with a transient unreadable result.
  if (kind === 'unreadable') return repo.transition(receiptId, {}, { at: Date.now(), type: 'reconcile_attempted', detail: 'target_state_unreadable' });
  return repo.transition(
    receiptId,
    {
      status: outcome.status,
      verification: outcome.verification,
      verificationBasis: outcome.basis,
      needsHuman: outcome.needsHumanReason !== null,
      needsHumanReason: outcome.needsHumanReason,
      finishedAt: outcome.status === 'OUTCOME_UNKNOWN' ? null : Date.now(),
    },
    { at: Date.now(), type: 'reconciled', detail: `${kind} => ${outcome.status}/${outcome.verification ?? '-'}` }
  );
}

/**
 * Startup recovery: every receipt still IN_FLIGHT that started before this process booted lost its owner (crash/restart mid-action). Each becomes
 * OUTCOME_UNKNOWN and is reconciled from the target state. Nothing is re-dispatched. Single-process assumption, same as the existing resume* functions.
 */
export async function recoverInFlightReceipts(startedBefore: number): Promise<{ recovered: number }> {
  const repo = getRepos().executionReceipts;
  const rows = repo.listInFlightStartedBefore(startedBefore);
  for (const r of rows) {
    try {
      repo.transition(r.id, { status: 'OUTCOME_UNKNOWN' }, { at: Date.now(), type: 'recovered_in_flight_after_restart' });
      await reconcileReceipt(r.id);
    } catch (e) {
      logger.error('VEL recovery failed for a receipt', { id: r.id, message: (e as Error).message });
    }
  }
  return { recovered: rows.length };
}
