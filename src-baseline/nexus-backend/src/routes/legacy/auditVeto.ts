import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

export function registerAuditVetoRoutes(router: Router) {
  router.post('/api/audit/veto', async (ctx: RouteContext) => {
    const body = await readJsonBody<{
      topic?: string;
      reviewerAgentId?: string;
      rejectedItems?: { item: string; reason: string }[];
      rawReviewText?: string;
    }>(ctx.req);
    if (!body.topic || !body.reviewerAgentId || !body.rawReviewText) {
      throw Errors.validation('الحقول topic وreviewerAgentId وrawReviewText مطلوبة.');
    }
    const event = getRepos().audit.logVeto(body.topic, body.reviewerAgentId, body.rejectedItems ?? [], body.rawReviewText);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ id: event.id, createdAt: event.createdAt }));
  });

  router.get('/api/audit/veto', async (ctx: RouteContext) => {
    const limit = Math.min(200, Number(ctx.query.get('limit') || '50') || 50);
    const before = ctx.query.get('before') ? Number(ctx.query.get('before')) : undefined;
    const events = getRepos().audit.listVeto(limit, before);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ events }));
  });
}
