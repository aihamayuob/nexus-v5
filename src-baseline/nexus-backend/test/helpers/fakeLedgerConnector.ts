import { createHash } from 'node:crypto';
import type { RegisteredTool } from '../../src/tools/registry.js';
import { EffectDispatchError, type EffectCallContext, type EffectLocator, type ToolEffectSpec } from '../../src/tools/effectTypes.js';

/**
 * TEST-ONLY ADAPTER — NOT a production connector and never registered by bootstrapTools().
 *
 * An in-memory "ledger" target system with deterministic, controlled fault injection, used to exercise the VEL gate (tools/verifiedExecution.ts).
 * It is a REAL target in the sense that matters for these tests: dispatch() really mutates `records`, and observe() really reads `records` —
 * so a test asserts the effect in the target system itself, never just on the tool's output text. Passing these tests says NOTHING about any
 * real connector, real network behaviour, or a real third-party idempotency implementation.
 */

export type DispatchFault =
  | 'ok' // applies the effect, acknowledges
  | 'reject' // definite failure: applies nothing, throws EffectDispatchError(definite)
  | 'apply_then_throw' // applies the effect, then throws an AMBIGUOUS network-like error (reply lost)
  | 'apply_then_hang' // applies the effect, then never settles (caller's timeout fires)
  | 'hang_no_apply' // never settles and applies nothing
  | 'throw_no_apply' // throws an ambiguous error without applying (connector crashed before applying)
  | 'ack_no_apply' // acknowledges success but applies NOTHING (a lying/buggy connector)
  | 'apply_twice' // applies the effect two times, acknowledges
  | 'apply_wrong_content'; // applies a record with the same entryId but DIFFERENT content, acknowledges

export interface LedgerRecord {
  entryId: string;
  account: string;
  digest: string;
  idem: string;
}

export const digestOf = (amount: unknown, note: unknown) => createHash('sha256').update(`${amount}|${note}`).digest('hex').slice(0, 16);

export class FakeLedger {
  records: LedgerRecord[] = [];
  dispatchCalls: Array<{ entryId: string; idempotencyKey: string; attempt: number; actionId: string; taskId: string }> = [];
  observeCalls = 0;
  /** Faults consumed in order, per entryId (deterministic even under concurrency). Empty queue => 'ok'. */
  faults = new Map<string, DispatchFault[]>();
  /** When true, a dispatch whose idempotencyKey was already applied is acknowledged WITHOUT applying again. */
  honorIdempotency = false;
  observeMode: 'normal' | 'unavailable' | 'hang' = 'normal';
  /** observe() can be made to fail only the first N times (to test reconcile-later). */
  observeFailuresLeft = 0;

  plan(entryId: string, ...faults: DispatchFault[]) {
    this.faults.set(entryId, faults);
  }

  countFor(entryId: string) {
    return this.records.filter((r) => r.entryId === entryId).length;
  }

  private nextFault(entryId: string): DispatchFault {
    return this.faults.get(entryId)?.shift() ?? 'ok';
  }

  async dispatch(input: Record<string, unknown>, call: EffectCallContext): Promise<{ ok: true; reference?: string }> {
    const entryId = String(input.entryId);
    this.dispatchCalls.push({ entryId, idempotencyKey: call.idempotencyKey, attempt: call.attempt, actionId: call.actionId, taskId: call.taskId });
    const fault = this.nextFault(entryId);
    const apply = (digest = digestOf(input.amount, input.note)) => this.records.push({ entryId, account: String(input.account), digest, idem: call.idempotencyKey });
    if (this.honorIdempotency && this.records.some((r) => r.idem === call.idempotencyKey) && fault !== 'reject') {
      return { ok: true, reference: 'idempotent-noop' };
    }
    switch (fault) {
      case 'ok':
        apply();
        return { ok: true, reference: entryId };
      case 'reject':
        throw new EffectDispatchError('ledger rejected the entry (nothing applied)', true);
      case 'apply_then_throw':
        apply();
        throw new Error('ECONNRESET: reply lost after the ledger applied the entry');
      case 'apply_then_hang':
        apply();
        return new Promise(() => undefined);
      case 'hang_no_apply':
        return new Promise(() => undefined);
      case 'throw_no_apply':
        throw new Error('ECONNRESET: connector died before applying');
      case 'ack_no_apply':
        return { ok: true, reference: 'phantom' };
      case 'apply_twice':
        apply();
        apply();
        return { ok: true, reference: entryId };
      case 'apply_wrong_content':
        apply('0000000000000000');
        return { ok: true, reference: entryId };
    }
  }

  async observe(locator: EffectLocator): Promise<{ readable: false; reason: string } | { readable: true; matches: number; conflicts: number }> {
    this.observeCalls++;
    if (this.observeMode === 'hang') return new Promise(() => undefined);
    if (this.observeMode === 'unavailable' || this.observeFailuresLeft > 0) {
      if (this.observeFailuresLeft > 0) this.observeFailuresLeft--;
      return { readable: false, reason: 'ledger read API unavailable' };
    }
    const atId = this.records.filter((r) => r.entryId === locator.entryId);
    return { readable: true, matches: atId.filter((r) => r.digest === locator.digest).length, conflicts: atId.filter((r) => r.digest !== locator.digest).length };
  }
}

export interface LedgerToolOptions {
  idempotency?: ToolEffectSpec['idempotency'];
  maxAttempts?: number;
  dispatchTimeoutMs?: number;
  observeTimeoutMs?: number;
  totalBudgetMs?: number;
}

export function makeLedgerTool(ledger: FakeLedger, o: LedgerToolOptions = {}): RegisteredTool {
  return {
    def: {
      name: 'ledger_append',
      description: 'TEST ONLY — append an entry to the fake ledger.',
      input_schema: {
        type: 'object',
        properties: { account: { type: 'string' }, entryId: { type: 'string' }, amount: { type: 'number' }, note: { type: 'string' } },
        required: ['account', 'entryId', 'amount'],
      },
    },
    timeoutMs: 5_000,
    effect: {
      connector: 'fake-ledger (TEST ONLY)',
      operation: 'ledger.append',
      resource: (i) => `ledger/${String(i.account)}`,
      summarize: (i) => `append ${String(i.entryId)} amount=${String(i.amount)} to ${String(i.account)}`, // the note is deliberately NOT included (may hold secrets)
      locator: (i) => ({ entryId: String(i.entryId), digest: digestOf(i.amount, i.note) }),
      successCondition: 'exactly one ledger record with this entryId and the submitted amount/note digest exists, and no other record shares the entryId',
      idempotency: o.idempotency ?? 'none',
      maxAttempts: o.maxAttempts ?? 1,
      dispatchTimeoutMs: o.dispatchTimeoutMs ?? 2_000,
      observeTimeoutMs: o.observeTimeoutMs ?? 2_000,
      totalBudgetMs: o.totalBudgetMs ?? 10_000,
      dispatch: (input, call) => ledger.dispatch(input, call),
      observe: (loc) => ledger.observe(loc),
    },
  };
}
