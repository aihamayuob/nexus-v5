import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

export function registerFeedbackRoutes(router: Router) {
  router.post('/v2/feedback', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ taskId?: string; rating?: string; note?: string }>(ctx.req);
    if (!body.taskId) throw Errors.validation('الحقل "taskId" مطلوب.');
    if (body.rating !== 'up' && body.rating !== 'down') throw Errors.validation('الحقل "rating" يجب أن يكون up أو down.');
    const task = getRepos().tasks.get(body.taskId);
    if (!task) throw Errors.notFound('المهمة غير موجودة.');
    const entry = getRepos().feedback.record(body.taskId, body.rating, body.note?.slice(0, 500) ?? null);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(entry));
  });
}
