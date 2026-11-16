import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { findConsolidationCandidates, dismissCandidate, mergeCandidate } from '../../dreaming/dreaming.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import type { MemoryKind } from '../../persistence/repositories/memoryRepo.js';
import type { ConsolidationStatus } from '../../persistence/repositories/memoryConsolidationRepo.js';

export function registerDreamingRoutes(router: Router) {
  /** Zero LLM calls, synchronous — pure similarity comparison over already-embedded items. */
  router.post('/v2/dreaming/scan', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ projectId?: string | null; kind?: MemoryKind; threshold?: number }>(ctx.req);
    if (!body.kind) throw Errors.validation('الحقل "kind" مطلوب.');
    const candidates = findConsolidationCandidates(body.projectId ?? null, body.kind, body.threshold);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ candidates }));
  });

  router.get('/v2/dreaming/candidates', async (ctx: RouteContext) => {
    const status = ctx.query.get('status') as ConsolidationStatus | null;
    const candidates = getRepos().memoryConsolidation.list({ status: status ?? undefined });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ candidates }));
  });

  router.post('/v2/dreaming/candidates/:id/dismiss', async (ctx: RouteContext) => {
    const candidate = dismissCandidate(ctx.params.id!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(candidate));
  });

  /** The ONLY path that can ever create a merged memory item — requires an explicit human-initiated HTTP call, never triggered by findConsolidationCandidates() or any background sweep. */
  router.post('/v2/dreaming/candidates/:id/merge', async (ctx: RouteContext) => {
    const result = await mergeCandidate(ctx.params.id!, ctx.gw);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(result));
  });
}
