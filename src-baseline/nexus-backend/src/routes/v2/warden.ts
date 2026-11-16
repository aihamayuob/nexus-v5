import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { Warden } from '../../warden/warden.js';

export function registerWardenRoutes(router: Router) {
  /** Single operational snapshot: budget + active mission/council/approval/isolated-agent counts. Read-only — Warden's mutating actions (cancel/pause/resume/isolate) live on their own routes below, so every one of them is audited. */
  router.get('/v2/warden/status', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(Warden.status()));
  });

  /** Phase 3 Slice 13 — ISOLATE. See Warden.isolateAgent() / agentRunner.ts's runAgentTask() for the real enforcement point (not merely advisory). agentId is a path param, not validated against AgentRegistry here on purpose — isolating an id that later gets registered, or one that was already removed, is still a harmless, legitimate no-op write (fail-closed default deny for that id, whenever it does exist). */
  router.post('/v2/warden/agents/:agentId/isolate', async (ctx: RouteContext) => {
    // Dedicated resilience-gap fix: this used to wrap readJsonBody in .catch(() => ({}))
    // to make the reason field genuinely optional. But readJsonBody() already returns {}
    // for a truly empty body (total === 0) — the .catch was strictly broader than that,
    // silently swallowing REAL errors too (payloadTooLarge/413, malformed-JSON/400),
    // which meant an oversized or invalid body on this route looked identical to "no
    // reason given" instead of being rejected. Not wrapping it lets genuine errors
    // propagate to the router's normal catch-and-respond path, while empty-body callers
    // are unaffected (still handled by readJsonBody's own total === 0 branch).
    const body = await readJsonBody<{ reason?: string }>(ctx.req);
    const { isolated } = Warden.isolateAgent(ctx.params.agentId!, body.reason ?? 'requested via API');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ isolated }));
  });

  router.post('/v2/warden/agents/:agentId/deisolate', async (ctx: RouteContext) => {
    const { deisolated } = Warden.deisolateAgent(ctx.params.agentId!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ deisolated }));
  });

  router.get('/v2/warden/agents/isolated', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ isolated: Warden.listIsolatedAgents() }));
  });
}
