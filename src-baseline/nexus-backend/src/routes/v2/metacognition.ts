import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { reviewMission, detectRepeatedFailurePatterns } from '../../metacognition/metaCognition.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import type { ProposalStatus, ProposalSubjectType } from '../../persistence/repositories/improvementProposalRepo.js';

export function registerMetaCognitionRoutes(router: Router) {
  /** Synchronous, not fire-and-poll — this is fundamentally ONE bounded agent call (like Verifier.verify()), not a multi-stage pipeline, so there's no reason to invent polling machinery for it. Returns the real proposals created (possibly zero — a genuinely clean mission produces none). */
  router.post('/v2/metacognition/missions/:id/review', async (ctx: RouteContext) => {
    const proposals = await reviewMission(ctx.params.id!, ctx.gw);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ proposals }));
  });

  /** Zero LLM calls, instant — pure aggregation over agent_failures. */
  router.post('/v2/metacognition/failure-patterns/detect', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ windowMs?: number; minCount?: number }>(ctx.req);
    const windowMs = body.windowMs ?? 24 * 60 * 60 * 1000;
    const minCount = body.minCount ?? 3;
    if (windowMs <= 0) throw Errors.validation('windowMs يجب أن يكون أكبر من صفر.');
    if (minCount <= 0) throw Errors.validation('minCount يجب أن يكون أكبر من صفر.');
    const proposals = detectRepeatedFailurePatterns(windowMs, minCount);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ proposals }));
  });

  router.get('/v2/metacognition/proposals', async (ctx: RouteContext) => {
    const status = ctx.query.get('status') as ProposalStatus | null;
    const subjectType = ctx.query.get('subjectType') as ProposalSubjectType | null;
    const proposals = getRepos().improvementProposals.list({ status: status ?? undefined, subjectType: subjectType ?? undefined });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ proposals }));
  });

  /** Records a human decision only — see metaCognition.ts's file doc comment: nothing is ever auto-applied, this is purely bookkeeping for a person who reviewed the proposal. */
  router.post('/v2/metacognition/proposals/:id/decide', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ status?: 'acknowledged' | 'dismissed'; decidedBy?: string }>(ctx.req);
    if (body.status !== 'acknowledged' && body.status !== 'dismissed') {
      throw Errors.validation('الحقل "status" يجب أن يكون "acknowledged" أو "dismissed".');
    }
    const existing = getRepos().improvementProposals.get(ctx.params.id!);
    if (!existing) throw Errors.notFound('الاقتراح غير موجود.');
    const updated = getRepos().improvementProposals.decide(ctx.params.id!, body.status, body.decidedBy ?? 'unknown');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(updated));
  });
}
