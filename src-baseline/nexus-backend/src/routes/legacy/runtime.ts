import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { planGoal } from '../../orchestrator/planner.js';
import { claimTask, runPlanTask, cancelTask } from '../../orchestrator/taskManager.js';
import { getStreamRegistry } from '../../orchestrator/streamRegistry.js';
import { SseWriter, startKeepAlive } from '../../streaming/sse.js';
import { getRepos } from '../../persistence/repos.js';
import { ProviderRegistry, type ProviderId } from '../../config/providerRegistry.js';
import { Errors } from '../../core/errors.js';
import { idempotencyKeyFor } from '../../core/ids.js';
import type { DagPlan } from '../../orchestrator/dagTypes.js';
import { logger } from '../../core/logger.js';

export function registerRuntimeRoutes(router: Router) {
  router.post('/api/runtime/plan', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ goal?: string; provider?: string }>(ctx.req);
    if (!body.goal || typeof body.goal !== 'string') throw Errors.validation('الحقل "goal" مطلوب.');
    if (!body.provider || !ProviderRegistry.has(body.provider)) throw Errors.validation('الحقل "provider" غير صالح.');
    const plan = await planGoal(body.goal, body.provider as ProviderId);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ tasks: plan.tasks, goal: plan.goal, provider: plan.provider }));
  });

  router.post('/api/runtime/run', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ plan?: DagPlan }>(ctx.req);
    if (!body.plan || !Array.isArray(body.plan.tasks) || body.plan.tasks.length === 0) {
      throw Errors.validation('الحقل "plan" مطلوب ويجب أن يحتوي مهاماً.');
    }
    if (!ProviderRegistry.has(body.plan.provider)) throw Errors.validation('مزود الخطة غير صالح.');

    const idemKey = idempotencyKeyFor(ctx.req.headers['idempotency-key'] as string | undefined, body.plan);
    const { taskId } = claimTask('runtime_plan', idemKey, ctx.gw, { provider: body.plan.provider, promptLen: body.plan.goal.length });

    const writer = new SseWriter(ctx.res);
    const registry = getStreamRegistry();
    registry.attach(taskId, writer);
    const keepAlive = startKeepAlive(writer);

    ctx.req.on('close', () => {
      if (!writer.isClosed) {
        cancelTask(taskId);
        logger.info('Client disconnected mid-plan, cancelled task', { taskId });
      }
    });

    // Run the plan and stream its events — runPlanTask manages its own
    // task-status/observability/checkpoint lifecycle; this route's only
    // job is transport (attach the writer, detach when the task manager
    // signals done via streamRegistry.markDone(), which happens in
    // runPlanTask's finally block).
    await runPlanTask(taskId, body.plan, body.plan.provider as ProviderId, ctx.gw);

    clearInterval(keepAlive);
    registry.detach(taskId, writer);
    writer.end();
  });

  // NEW (additive, non-breaking): resume for the Agent Runtime SSE
  // stream, same pattern as the existing /api/chat/resume/:requestId —
  // the frontend doesn't call this yet, but it's available for a future
  // frontend pass and is exercised by this backend's own resume-after-
  // restart logic conceptually (see taskManager.resumeInterruptedPlans).
  router.get('/api/runtime/resume/:taskId', async (ctx: RouteContext) => {
    const taskId = ctx.params.taskId!;
    const afterId = Number(ctx.query.get('afterId') || '0') || 0;
    const task = getRepos().tasks.get(taskId);
    if (!task) throw Errors.notFound('لا توجد مهمة بهذا المعرّف.');

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

  // NEW (additive): explicit cancellation endpoint for a running plan.
  router.post('/api/runtime/:taskId/cancel', async (ctx: RouteContext) => {
    const ok = cancelTask(ctx.params.taskId!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ cancelled: ok }));
  });
}
