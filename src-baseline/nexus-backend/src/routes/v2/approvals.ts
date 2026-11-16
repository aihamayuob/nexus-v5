import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { decideApproval } from '../../orchestrator/approvalGate.js';
import { Errors } from '../../core/errors.js';

export function registerApprovalRoutes(router: Router) {
  router.get('/v2/approvals', async (ctx: RouteContext) => {
    const pending = getRepos().approvals.pending();
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ pending }));
  });

  router.post('/v2/approvals/:taskId/decide', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ decision?: string; decidedBy?: string }>(ctx.req);
    if (body.decision !== 'approved' && body.decision !== 'rejected') {
      throw Errors.validation('الحقل "decision" يجب أن يكون approved أو rejected.');
    }
    const result = decideApproval(ctx.params.taskId!, body.decision, body.decidedBy ?? ctx.gw.clientKey);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(result));
  });
}
