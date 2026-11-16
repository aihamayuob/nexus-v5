import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { buildDataset, approveDataset, rejectDataset, submitJob, pollJob, listJobs } from '../../finetuning/fineTuning.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

/** Controlled Fine-Tuning routes — every mutating action requires an explicit human identity (approvedBy/decidedBy), same contract as evolution routes. */
export function registerFineTuningRoutes(router: Router) {
  router.post('/v2/finetuning/agents/:agentId/build-dataset', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix — see warden.ts's isolate handler for rationale.
    const body = await readJsonBody<{ baseModel?: string }>(ctx.req);
    const record = buildDataset(ctx.params.agentId!, body.baseModel);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.get('/v2/finetuning/agents/:agentId/jobs', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ jobs: listJobs(ctx.params.agentId!) }));
  });

  router.get('/v2/finetuning/jobs/:id', async (ctx: RouteContext) => {
    const record = getRepos().fineTuningJobs.get(ctx.params.id!);
    if (!record) throw Errors.notFound('مهمة التدريب غير موجودة.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/finetuning/jobs/:id/approve', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ approvedBy?: string }>(ctx.req);
    const record = approveDataset(ctx.params.id!, body.approvedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/finetuning/jobs/:id/reject', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ decidedBy?: string }>(ctx.req);
    const record = rejectDataset(ctx.params.id!, body.decidedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/finetuning/jobs/:id/submit', async (ctx: RouteContext) => {
    const record = await submitJob(ctx.params.id!);
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/finetuning/jobs/:id/poll', async (ctx: RouteContext) => {
    const record = await pollJob(ctx.params.id!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });
}
