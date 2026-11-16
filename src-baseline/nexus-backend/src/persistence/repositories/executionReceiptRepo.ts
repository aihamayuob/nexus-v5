import type { DatabaseSync } from 'node:sqlite';

/** Lifecycle status of one VEL action — NOT an evidence verdict (that is `verification`). See migration 017. */
export type ReceiptStatus = 'IN_FLIGHT' | 'DENIED' | 'FAILED' | 'ACKED' | 'OUTCOME_UNKNOWN' | 'RECONCILED_APPLIED' | 'RECONCILED_NOT_APPLIED';
/** The EXISTING five evidence states (evaluation/evaluationEngine.ts) — reused unchanged, not extended. */
export type ReceiptVerification = 'VERIFIED' | 'SUPPORTED' | 'UNCERTAIN' | 'CONFLICTING' | 'UNVERIFIED';

export interface ReceiptEvent {
  at: number;
  type: string;
  attemptId?: string;
  detail?: string;
}

export interface ExecutionReceipt {
  id: string;
  taskId: string | null;
  toolName: string;
  toolUseId: string | null;
  connector: string;
  operation: string;
  resource: string | null;
  paramsDigest: string;
  paramsSummary: string | null;
  locator: Record<string, string | number | boolean> | null;
  dedupeKey: string;
  idempotencyKey: string | null;
  idempotencyMode: string | null;
  actorRef: string;
  projectId: string | null;
  userId: string | null;
  providerId: string | null;
  policyVersion: string;
  policyDecision: 'allow' | 'deny';
  policyRuleId: string | null;
  policyReason: string;
  successCondition: string | null;
  status: ReceiptStatus;
  verification: ReceiptVerification | null;
  verificationBasis: string | null;
  attemptCount: number;
  lastAttemptId: string | null;
  needsHuman: boolean;
  needsHumanReason: string | null;
  proofLimits: string | null;
  events: ReceiptEvent[];
  startedAt: number;
  finishedAt: number | null;
  updatedAt: number;
}

export type NewReceipt = Omit<
  ExecutionReceipt,
  'events' | 'updatedAt' | 'finishedAt' | 'attemptCount' | 'lastAttemptId' | 'needsHuman' | 'needsHumanReason' | 'verification' | 'verificationBasis' | 'proofLimits'
> &
  Partial<Pick<ExecutionReceipt, 'verification' | 'verificationBasis' | 'needsHuman' | 'needsHumanReason' | 'proofLimits' | 'finishedAt'>>;

export type ReceiptPatch = Partial<
  Pick<ExecutionReceipt, 'status' | 'verification' | 'verificationBasis' | 'attemptCount' | 'lastAttemptId' | 'needsHuman' | 'needsHumanReason' | 'proofLimits' | 'finishedAt'>
>;

export const ACTIVE_STATUSES: readonly ReceiptStatus[] = ['IN_FLIGHT', 'ACKED', 'OUTCOME_UNKNOWN', 'RECONCILED_APPLIED'];
const MAX_EVENTS = 60;

function rowToReceipt(r: Record<string, unknown>): ExecutionReceipt {
  return {
    id: r.id as string,
    taskId: (r.task_id as string) ?? null,
    toolName: r.tool_name as string,
    toolUseId: (r.tool_use_id as string) ?? null,
    connector: r.connector as string,
    operation: r.operation as string,
    resource: (r.resource as string) ?? null,
    paramsDigest: r.params_digest as string,
    paramsSummary: (r.params_summary as string) ?? null,
    locator: r.locator_json ? (JSON.parse(r.locator_json as string) as ExecutionReceipt['locator']) : null,
    dedupeKey: r.dedupe_key as string,
    idempotencyKey: (r.idempotency_key as string) ?? null,
    idempotencyMode: (r.idempotency_mode as string) ?? null,
    actorRef: r.actor_ref as string,
    projectId: (r.project_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    providerId: (r.provider_id as string) ?? null,
    policyVersion: r.policy_version as string,
    policyDecision: r.policy_decision as 'allow' | 'deny',
    policyRuleId: (r.policy_rule_id as string) ?? null,
    policyReason: r.policy_reason as string,
    successCondition: (r.success_condition as string) ?? null,
    status: r.status as ReceiptStatus,
    verification: (r.verification as ReceiptVerification) ?? null,
    verificationBasis: (r.verification_basis as string) ?? null,
    attemptCount: r.attempt_count as number,
    lastAttemptId: (r.last_attempt_id as string) ?? null,
    needsHuman: (r.needs_human as number) === 1,
    needsHumanReason: (r.needs_human_reason as string) ?? null,
    proofLimits: (r.proof_limits as string) ?? null,
    events: JSON.parse((r.events_json as string) || '[]') as ReceiptEvent[],
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number) ?? null,
    updatedAt: r.updated_at as number,
  };
}

export class ExecutionReceiptRepo {
  constructor(private db: DatabaseSync) {}

  /**
   * Inserts a receipt. Returns { ok:false } ONLY when the unique active-dedupe index rejects it (an identical action is already active) —
   * every OTHER failure (disk full, locked DB, missing table) THROWS, so the caller can fail closed ("not documented => not executed").
   */
  insert(n: NewReceipt, firstEvent: ReceiptEvent): { ok: true } | { ok: false } {
    const now = Date.now();
    try {
      this.db
        .prepare(
          `INSERT INTO execution_receipts (id, task_id, tool_name, tool_use_id, connector, operation, resource, params_digest, params_summary, locator_json, dedupe_key, idempotency_key, idempotency_mode,
             actor_ref, project_id, user_id, provider_id, policy_version, policy_decision, policy_rule_id, policy_reason, success_condition, status, verification, verification_basis,
             attempt_count, last_attempt_id, needs_human, needs_human_reason, proof_limits, events_json, started_at, finished_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          n.id,
          n.taskId,
          n.toolName,
          n.toolUseId,
          n.connector,
          n.operation,
          n.resource,
          n.paramsDigest,
          n.paramsSummary,
          n.locator ? JSON.stringify(n.locator) : null,
          n.dedupeKey,
          n.idempotencyKey,
          n.idempotencyMode,
          n.actorRef,
          n.projectId,
          n.userId,
          n.providerId,
          n.policyVersion,
          n.policyDecision,
          n.policyRuleId,
          n.policyReason,
          n.successCondition,
          n.status,
          n.verification ?? null,
          n.verificationBasis ?? null,
          n.needsHuman ? 1 : 0,
          n.needsHumanReason ?? null,
          n.proofLimits ?? null,
          JSON.stringify([firstEvent]),
          n.startedAt,
          n.finishedAt ?? null,
          now
        );
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message || '';
      if (/UNIQUE constraint failed/i.test(msg) && /dedupe_key/i.test(msg)) return { ok: false };
      throw e;
    }
  }

  get(id: string): ExecutionReceipt | null {
    const row = this.db.prepare('SELECT * FROM execution_receipts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToReceipt(row) : null;
  }

  /** The one receipt currently holding this dedupe key (IN_FLIGHT / ACKED / OUTCOME_UNKNOWN / RECONCILED_APPLIED), if any. */
  findActiveByDedupe(dedupeKey: string): ExecutionReceipt | null {
    const row = this.db
      .prepare(`SELECT * FROM execution_receipts WHERE dedupe_key = ? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')}) ORDER BY started_at DESC, rowid DESC LIMIT 1`)
      .get(dedupeKey, ...ACTIVE_STATUSES) as Record<string, unknown> | undefined;
    return row ? rowToReceipt(row) : null;
  }

  /** How many NON-denied actions this task has already started for this tool (the policy's per-task call bound). */
  countStartedForTask(taskId: string, toolName: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM execution_receipts WHERE task_id = ? AND tool_name = ? AND status != 'DENIED'").get(taskId, toolName) as { n: number };
    return row.n;
  }

  list(opts: { taskId?: string; status?: ReceiptStatus; unresolvedOnly?: boolean; limit?: number } = {}): ExecutionReceipt[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.taskId) {
      where.push('task_id = ?');
      args.push(opts.taskId);
    }
    if (opts.status) {
      where.push('status = ?');
      args.push(opts.status);
    }
    if (opts.unresolvedOnly) {
      where.push("(status IN ('IN_FLIGHT', 'OUTCOME_UNKNOWN') OR needs_human = 1 OR (status = 'ACKED' AND (verification IS NULL OR verification != 'VERIFIED')))");
    }
    const sql = `SELECT * FROM execution_receipts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC, rowid DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...args, Math.min(Math.max(opts.limit ?? 50, 1), 200)) as Record<string, unknown>[];
    return rows.map(rowToReceipt);
  }

  /** IN_FLIGHT receipts that started before `startedBefore` (startup recovery: anything in flight before this process booted cannot belong to it). */
  listInFlightStartedBefore(startedBefore: number): ExecutionReceipt[] {
    const rows = this.db.prepare("SELECT * FROM execution_receipts WHERE status = 'IN_FLIGHT' AND started_at < ? ORDER BY started_at ASC").all(startedBefore) as Record<string, unknown>[];
    return rows.map(rowToReceipt);
  }

  /** Applies a patch and appends one timeline event in a single synchronous (therefore non-interleaving) read-modify-write. Throws on any storage failure — the caller decides what an undocumented transition means. */
  transition(id: string, patch: ReceiptPatch, event: ReceiptEvent): ExecutionReceipt {
    const row = this.db.prepare('SELECT events_json FROM execution_receipts WHERE id = ?').get(id) as { events_json: string } | undefined;
    if (!row) throw new Error(`execution receipt ${id} not found`);
    const events = JSON.parse(row.events_json || '[]') as ReceiptEvent[];
    events.push(event);
    const trimmed = events.length > MAX_EVENTS ? [events[0]!, ...events.slice(events.length - (MAX_EVENTS - 1))] : events;
    const sets: string[] = ['events_json = ?', 'updated_at = ?'];
    const args: (string | number | null)[] = [JSON.stringify(trimmed), Date.now()];
    const col = (name: string, value: string | number | null) => {
      sets.push(`${name} = ?`);
      args.push(value);
    };
    if (patch.status !== undefined) col('status', patch.status);
    if (patch.verification !== undefined) col('verification', patch.verification);
    if (patch.verificationBasis !== undefined) col('verification_basis', patch.verificationBasis);
    if (patch.attemptCount !== undefined) col('attempt_count', patch.attemptCount);
    if (patch.lastAttemptId !== undefined) col('last_attempt_id', patch.lastAttemptId);
    if (patch.needsHuman !== undefined) col('needs_human', patch.needsHuman ? 1 : 0);
    if (patch.needsHumanReason !== undefined) col('needs_human_reason', patch.needsHumanReason);
    if (patch.proofLimits !== undefined) col('proof_limits', patch.proofLimits);
    if (patch.finishedAt !== undefined) col('finished_at', patch.finishedAt);
    this.db.prepare(`UPDATE execution_receipts SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
    return this.get(id)!;
  }
}
