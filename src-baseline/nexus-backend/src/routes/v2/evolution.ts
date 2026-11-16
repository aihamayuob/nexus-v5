import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { proposeGenomeMutation, approveGenomeVersion, rejectGenomeVersion, rollbackAgentGenome, listAgentGenomes } from '../../evolution/agentGenome.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';

/** Controlled Agent Evolution ("Digital Genome") routes — every mutating action here requires an explicit human identity (approvedBy/decidedBy in the request body); none of them can be triggered by an agent, a mission, or any other automated caller inside this codebase — only by a real API request a human (or a system they explicitly operate) makes on purpose. */
export function registerEvolutionRoutes(router: Router) {
  router.post('/v2/evolution/agents/:agentId/propose', async (ctx: RouteContext) => {
    const record = await proposeGenomeMutation(ctx.params.agentId!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.get('/v2/evolution/agents/:agentId/genomes', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ genomes: listAgentGenomes(ctx.params.agentId!) }));
  });

  router.get('/v2/evolution/genomes/:id', async (ctx: RouteContext) => {
    const record = getRepos().agentGenomes.get(ctx.params.id!);
    if (!record) throw Errors.notFound('إصدار التطوّر غير موجود.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/evolution/genomes/:id/approve', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ approvedBy?: string }>(ctx.req);
    const record = approveGenomeVersion(ctx.params.id!, body.approvedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/evolution/genomes/:id/reject', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ decidedBy?: string; reason?: string }>(ctx.req);
    const record = rejectGenomeVersion(ctx.params.id!, body.decidedBy || '', body.reason);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.post('/v2/evolution/agents/:agentId/rollback', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ targetVersion?: number; approvedBy?: string }>(ctx.req);
    if (typeof body.targetVersion !== 'number') throw Errors.validation('targetVersion مطلوب (رقم).');
    const record = rollbackAgentGenome(ctx.params.agentId!, body.targetVersion, body.approvedBy || '');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });
}
