import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { ProviderRegistry } from '../../config/providerRegistry.js';
import { Errors } from '../../core/errors.js';
import type { ScheduleRecurrence } from '../../persistence/repositories/scheduleRepo.js';

export function registerScheduleRoutes(router: Router) {
  router.get('/api/schedules', async (ctx: RouteContext) => {
    const schedules = getRepos().schedules.list();
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ schedules }));
  });

  router.post('/api/schedules', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ goal?: string; provider?: string; model?: string; recurrence?: ScheduleRecurrence }>(ctx.req);
    if (!body.goal) throw Errors.validation('الحقل "goal" مطلوب.');
    if (!body.provider || !ProviderRegistry.has(body.provider)) throw Errors.validation('الحقل "provider" غير صالح.');
    if (!body.recurrence) throw Errors.validation('الحقل "recurrence" مطلوب.');
    const model = body.model || ProviderRegistry.resolve(body.provider).resolvedModel;
    const schedule = getRepos().schedules.create(body.goal, body.provider, model, body.recurrence);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(schedule));
  });

  router.delete('/api/schedules/:id', async (ctx: RouteContext) => {
    getRepos().schedules.remove(ctx.params.id!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ deleted: true }));
  });

  // Restoration-pass fix: the frontend's schedule enable/disable checkbox
  // (toggleSchedule()) has always sent this exact request — the repo-level
  // setEnabled() already existed, and Router now has .patch() (see its own
  // comment) — this route is the last missing piece connecting an already-
  // built frontend feature to an already-built data-layer method, not a new
  // capability.
  router.patch('/api/schedules/:id', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ enabled?: boolean }>(ctx.req);
    if (typeof body.enabled !== 'boolean') throw Errors.validation('الحقل "enabled" مطلوب ويجب أن يكون قيمة منطقية (true/false).');
    getRepos().schedules.setEnabled(ctx.params.id!, body.enabled);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ id: ctx.params.id, enabled: body.enabled }));
  });
}
