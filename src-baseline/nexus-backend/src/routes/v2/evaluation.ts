import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { runBenchmarkSuiteAndCompare } from '../../evaluation/benchmarkRunner.js';
import { EvaluationEngine, isEvidenceDeltaKind, type EvidenceItem } from '../../evaluation/evaluationEngine.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

export function registerEvaluationRoutes(router: Router) {
  router.post('/v2/evaluation/run', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ releaseLabel?: string }>(ctx.req);
    const releaseLabel = body.releaseLabel || `run_${new Date().toISOString()}`;
    const { results, summary, regression, runId } = await runBenchmarkSuiteAndCompare(releaseLabel);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ runId, releaseLabel, results, summary, regression }));
  });

  router.get('/v2/evaluation/latest', async (ctx: RouteContext) => {
    const latest = getRepos().benchmarkRuns.latest();
    if (!latest) throw Errors.notFound('لا توجد نتائج تقييم بعد — شغّل POST /v2/evaluation/run أولاً.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(latest));
  });

  router.get('/v2/evaluation/history', async (ctx: RouteContext) => {
    const limit = Math.min(50, Number(ctx.query.get('limit') || '20') || 20);
    const runs = getRepos().benchmarkRuns.list(limit);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ runs }));
  });

  // ---- Phase 3 Slice 16: Unified Evaluation Engine — a DIFFERENT concern
  // from the benchmark-suite routes above (see evaluationEngine.ts's
  // header comment). General-purpose: any caller (a user, a mission, a
  // council synthesis) can submit a claim + the evidence they gathered
  // for it and get back an independent VERIFIED/SUPPORTED/UNCERTAIN/
  // CONFLICTING/UNVERIFIED judgment — this is what makes it "unified"
  // rather than something baked privately into Web Research alone. ----

  router.post('/v2/evaluation/claim', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ claim?: string; evidence?: EvidenceItem[]; subjectType?: string; subjectId?: string | null; privacyMode?: string }>(ctx.req);
    if (!body.claim || !body.claim.trim()) throw Errors.validation('الحقل "claim" مطلوب.');
    // Evidence Integrity (ADR-004): `kind` is optional and only a valid declared kind is kept; anything else is dropped from the stored/returned
    // item (the item itself stays, as audit trail) and the engine will treat it as a non-delta. Other fields of an item are passed through as before.
    const evidence: EvidenceItem[] = Array.isArray(body.evidence)
      ? body.evidence
          .filter((e) => e && typeof e.source === 'string' && typeof e.content === 'string')
          .map((e) => {
            const { kind, ...rest } = e;
            return isEvidenceDeltaKind(kind) ? { ...rest, kind } : rest;
          })
      : [];
    // GAP-1B: `privacyMode` (LOCAL_ONLY|PRIVATE) and `subjectId` (a task id) can only RESTRICT the cloud judge call, never widen it — the server decides (security/cloudEgressGuard.ts).
    const result = await EvaluationEngine.evaluate(body.claim, evidence, { taskId: body.subjectId ?? null, privacyMode: body.privacyMode });
    const record = getRepos().claimEvaluations.save(body.subjectType || 'api', body.subjectId ?? null, body.claim, evidence, result);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.get('/v2/evaluation/claims/:id', async (ctx: RouteContext) => {
    const record = getRepos().claimEvaluations.get(ctx.params.id!);
    if (!record) throw Errors.notFound('لم يُعثر على هذا التقييم.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.get('/v2/evaluation/claims', async (ctx: RouteContext) => {
    const limit = Math.min(50, Number(ctx.query.get('limit') || '20') || 20);
    const subjectType = ctx.query.get('subjectType') || undefined;
    const records = getRepos().claimEvaluations.list(limit, subjectType);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ evaluations: records }));
  });
}
