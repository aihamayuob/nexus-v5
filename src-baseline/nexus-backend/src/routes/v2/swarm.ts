import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { formSwarm } from '../../swarm/swarm.js';
import { Errors } from '../../core/errors.js';

interface FormSwarmRequestBody {
  topic?: string;
  maxAgents?: number;
  humanitarianVeto?: boolean;
}

export function registerSwarmRoutes(router: Router) {
  /**
   * Fire-and-poll, same contract as POST /v2/council. Response includes
   * `selectedAgentIds` so the caller can see WHICH specialists were
   * dynamically chosen — poll GET /v2/council/:id (the returned
   * sessionId) and GET /v2/council/:id/rounds for progress, exactly like
   * any other Council session; no separate swarm-status endpoint exists
   * because a swarm session IS a council session underneath.
   */
  router.post('/v2/swarm', async (ctx: RouteContext) => {
    const body = await readJsonBody<FormSwarmRequestBody>(ctx.req);
    if (!body.topic || !body.topic.trim()) throw Errors.validation('الحقل "topic" مطلوب.');
    const result = await formSwarm(body.topic, ctx.gw, body.maxAgents, body.humanitarianVeto === true);
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(result));
  });
}
