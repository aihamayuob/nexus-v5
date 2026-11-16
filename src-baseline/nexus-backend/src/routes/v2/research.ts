import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { runWebResearch } from '../../research/webResearch.js';
import { Errors } from '../../core/errors.js';

export function registerResearchRoutes(router: Router) {
  /** Synchronous — one bounded Gemini call + a handful of parallel SSRF-protected fetches, same shape as Verifier/Meta-Cognition's single-call endpoints, not a multi-stage pipeline needing fire-and-poll. */
  router.post('/v2/research/web', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ question?: string; persistToMemory?: boolean; projectId?: string | null; evaluate?: boolean }>(ctx.req);
    if (!body.question || !body.question.trim()) throw Errors.validation('الحقل "question" مطلوب.');
    const result = await runWebResearch(body.question, ctx.gw, { persistToMemory: body.persistToMemory, projectId: body.projectId ?? null, evaluate: body.evaluate });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(result));
  });
}
