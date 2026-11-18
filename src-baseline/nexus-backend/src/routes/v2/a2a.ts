import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { Errors, normalizeError } from '../../core/errors.js';
import { ServerConfig } from '../../config/env.js';
import { buildAgentCard, handleA2aRpc, isA2aEnabled } from '../../a2a/a2aServer.js';

/** A2A server surface (A1). Opt-in via NEXUS_A2A_PROVIDER; see a2a/a2aServer.ts for scope and limits. */
export function registerA2aRoutes(router: Router) {
  // Public discovery document (no secret inside; see test). 404 when the A2A surface is not enabled.
  router.get(
    '/.well-known/agent-card.json',
    async (ctx: RouteContext) => {
      if (!isA2aEnabled()) throw Errors.notFound();
      const base = ServerConfig.a2aPublicUrl || `http://${ctx.req.headers.host ?? 'localhost'}`;
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify(buildAgentCard(base)));
    },
    { skipAuth: true }
  );

  router.post('/a2a', async (ctx: RouteContext) => {
    if (!isA2aEnabled()) throw Errors.notFound();
    let msg: unknown;
    try {
      msg = await readJsonBody<unknown>(ctx.req);
    } catch (e) {
      const n = normalizeError(e);
      if (n.code === 'validation_error') {
        ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
        return void ctx.res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
      }
      throw e;
    }
    const out = await handleA2aRpc(msg, ctx.req.headers, ctx.gw);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(out));
  });
}
