import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { checkFreshness, refreshStaleItem, acceptRefresh, dismissRefresh, scanForStaleness } from '../../knowledge/freshnessEngine.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

export function registerKnowledgeFreshnessRoutes(router: Router) {
  router.post('/v2/knowledge-freshness/items/:memoryItemId/check', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ privacyMode?: string }>(ctx.req);
    const record = await checkFreshness(ctx.params.memoryItemId!, { privacyMode: body.privacyMode });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/knowledge-freshness/scan', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix — see warden.ts's isolate handler for rationale.
    const body = await readJsonBody<{ limit?: number; privacyMode?: string }>(ctx.req);
    const results = await scanForStaleness(ctx.gw.projectId, Math.min(200, body.limit ?? 50), { privacyMode: body.privacyMode });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ checked: results.length, results }));
  });

  router.get('/v2/knowledge-freshness/stale', async (ctx: RouteContext) => {
    const limit = Math.min(100, Number(ctx.query.get('limit') || '50') || 50);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ stale: getRepos().knowledgeFreshness.pendingStale(limit) }));
  });

  router.get('/v2/knowledge-freshness/checks/:id', async (ctx: RouteContext) => {
    const record = getRepos().knowledgeFreshness.get(ctx.params.id!);
    if (!record) throw Errors.notFound('فحص التقادم غير موجود.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/knowledge-freshness/checks/:id/refresh', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ privacyMode?: string }>(ctx.req);
    const record = await refreshStaleItem(ctx.params.id!, ctx.gw, { privacyMode: body.privacyMode });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/knowledge-freshness/checks/:id/accept', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ decidedBy?: string }>(ctx.req);
    const record = acceptRefresh(ctx.params.id!, body.decidedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/knowledge-freshness/checks/:id/dismiss', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ decidedBy?: string }>(ctx.req);
    const record = dismissRefresh(ctx.params.id!, body.decidedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });
}
