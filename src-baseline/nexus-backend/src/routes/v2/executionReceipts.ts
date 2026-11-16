import type { Router, RouteContext } from '../../gateway/router.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import { reconcileReceipt } from '../../tools/verifiedExecution.js';
import type { ReceiptStatus } from '../../persistence/repositories/executionReceiptRepo.js';

const STATUSES = new Set<ReceiptStatus>(['IN_FLIGHT', 'DENIED', 'FAILED', 'ACKED', 'OUTCOME_UNKNOWN', 'RECONCILED_APPLIED', 'RECONCILED_NOT_APPLIED']);

/**
 * NEXUS VEL — read access to durable execution receipts (tools/verifiedExecution.ts) plus a READ-ONLY reconcile.
 * Nothing here can dispatch an action: reconcile only re-reads the target system's state and records what it finds.
 * Receipts never contain raw parameters or secrets (digest + connector-redacted summary + non-secret locator only).
 */
export function registerExecutionReceiptRoutes(router: Router) {
  router.get('/v2/execution-receipts', async (ctx: RouteContext) => {
    const status = ctx.query.get('status') || undefined;
    if (status && !STATUSES.has(status as ReceiptStatus)) throw Errors.validation('قيمة "status" غير معروفة.');
    const receipts = getRepos().executionReceipts.list({
      taskId: ctx.query.get('taskId') || undefined,
      status: status as ReceiptStatus | undefined,
      unresolvedOnly: ctx.query.get('unresolved') === '1',
      limit: Number(ctx.query.get('limit') || '50') || 50,
    });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ receipts }));
  });

  router.get('/v2/execution-receipts/:id', async (ctx: RouteContext) => {
    const r = getRepos().executionReceipts.get(ctx.params.id!);
    if (!r) throw Errors.notFound('لم يُعثر على هذا الإيصال.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(r));
  });

  router.post('/v2/execution-receipts/:id/reconcile', async (ctx: RouteContext) => {
    const r = await reconcileReceipt(ctx.params.id!);
    if (!r) throw Errors.notFound('لم يُعثر على هذا الإيصال.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(r));
  });
}
