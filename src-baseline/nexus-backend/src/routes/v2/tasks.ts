import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { claimUnifiedTask, dispatchUnifiedTask } from '../../orchestrator/taskEntryPoint.js';
import { cancelTask } from '../../orchestrator/taskManager.js';
import { getStreamRegistry } from '../../orchestrator/streamRegistry.js';
import { SseWriter, startKeepAlive } from '../../streaming/sse.js';
import { getRepos } from '../../persistence/repos.js';
import { ProviderRegistry, type ProviderId } from '../../config/providerRegistry.js';
import { Errors } from '../../core/errors.js';
import type { ToolDef } from '../../providers/contract.js';
import { logger } from '../../core/logger.js';

export function registerV2TaskRoutes(router: Router) {
  // POST /v2/tasks — submit a request, get back a streaming SSE response
  // whose FIRST event (task_meta) always describes the Execution Policy
  // decision (tier + why), then streams whatever that tier actually needs
  // — a single fast completion, or a full plan+parallel-agents+verifier
  // run, transparently, with no client-side branching required.
  router.post('/v2/tasks', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ input?: string; provider?: string; tools?: ToolDef[] }>(ctx.req);
    if (!body.input || typeof body.input !== 'string') throw Errors.validation('الحقل "input" مطلوب.');
    if (!body.provider || !ProviderRegistry.has(body.provider)) throw Errors.validation('الحقل "provider" غير صالح.');

    const writer = new SseWriter(ctx.res);
    const registry = getStreamRegistry();
    const keepAlive = startKeepAlive(writer);

    // claim (synchronous, no events yet) -> attach the writer -> THEN
    // dispatch (which emits task_meta first thing) — this exact order is
    // required so the writer is already listening before anything is
    // emitted; see taskEntryPoint.ts's doc comment for why reversing it
    // silently drops the first event for this connection.
    const { taskId, decision, reusedExisting } = claimUnifiedTask(body.input, body.provider as ProviderId, ctx.gw, {
      tools: body.tools,
      idempotencyKey: ctx.req.headers['idempotency-key'] as string | undefined,
    });
    registry.attach(taskId, writer);
    dispatchUnifiedTask(taskId, decision, reusedExisting, body.input, body.provider as ProviderId, ctx.gw, body.tools);

    ctx.req.on('close', () => {
      if (!writer.isClosed) {
        cancelTask(taskId);
        logger.info('Client disconnected from /v2/tasks stream, cancelled task', { taskId });
      }
      clearInterval(keepAlive);
      registry.detach(taskId, writer);
    });

    // Poll until the task reaches a terminal state or genuinely pauses for
    // approval — dispatch() runs in the background (see taskEntryPoint.ts);
    // this loop just keeps the HTTP response open while it does, the same
    // role runPlanTask's own await plays for /api/runtime/run.
    const start = Date.now();
    while (Date.now() - start < 15 * 60_000) {
      const task = getRepos().tasks.get(taskId);
      if (!task) break;
      if (task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') break;
      if (registry.isDone(taskId)) break; // e.g. awaiting-approval path marks the stream done differently — see approvalGate.ts
      const approval = getRepos().approvals.get(taskId);
      if (approval && approval.status === 'pending') break; // awaiting a human decision — end this connection, client polls/resumes later
      await new Promise((r) => setTimeout(r, 300));
    }

    clearInterval(keepAlive);
    registry.detach(taskId, writer);
    writer.end();
  });

  router.get('/v2/tasks/:taskId', async (ctx: RouteContext) => {
    const task = getRepos().tasks.get(ctx.params.taskId!);
    if (!task) throw Errors.notFound('المهمة غير موجودة.');
    const approval = getRepos().approvals.get(task.id);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ task, approval }));
  });

  router.get('/v2/tasks/:taskId/stream', async (ctx: RouteContext) => {
    const taskId = ctx.params.taskId!;
    const afterId = Number(ctx.query.get('afterId') || '0') || 0;
    const task = getRepos().tasks.get(taskId);
    if (!task) throw Errors.notFound('المهمة غير موجودة.');

    const writer = new SseWriter(ctx.res);
    const registry = getStreamRegistry();
    registry.replay(taskId, afterId, writer);
    if (registry.isDone(taskId) || task.status === 'done' || task.status === 'failed' || task.status === 'cancelled') {
      writer.end();
      return;
    }
    const keepAlive = startKeepAlive(writer);
    registry.attach(taskId, writer);
    ctx.req.on('close', () => {
      clearInterval(keepAlive);
      registry.detach(taskId, writer);
    });
  });

  router.post('/v2/tasks/:taskId/cancel', async (ctx: RouteContext) => {
    const ok = cancelTask(ctx.params.taskId!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ cancelled: ok }));
  });
}
