import type { Router, RouteContext } from '../../gateway/router.js';
import { listModelsMetadata } from '../../providers/modelRouter.js';
import { getAllProviderHealth } from '../../providers/healthRegistry.js';
import { selectProviderForMode, type RoutingMode } from '../../providers/routingModes.js';
import { getRepos } from '../../persistence/repos.js';
import { BudgetGuard } from '../../orchestrator/budget.js';
import { taskManagerStatus } from '../../orchestrator/taskManager.js';
import { assertNoSecretLeak } from '../../security/secrets.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { Errors } from '../../core/errors.js';
import type { ProviderId } from '../../config/providerRegistry.js';

const API_VERSION = 2;

export function registerV2Routes(router: Router) {
  router.get(
    '/v2/health',
    async (ctx: RouteContext) => {
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ ok: true, version: API_VERSION, ...taskManagerStatus() }));
    },
    { skipAuth: true }
  );

  router.get('/v2/models', async (ctx: RouteContext) => {
    const payload = { version: API_VERSION, providers: listModelsMetadata() };
    assertNoSecretLeak(payload);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(payload));
  });

  /**
   * Live provider health — the READY/DEGRADED/UNAVAILABLE/NOT_CONFIGURED
   * state model from Phase 1 §5. Distinct from GET /v2/models (which stays
   * fast/unchanged for existing callers): this route may perform a real
   * network probe per provider, so it's opt-in for callers that actually
   * need live state rather than baked into every /v2/models call.
   * ?probe=1 bypasses the 30s cache and forces a fresh check.
   */
  router.get('/v2/providers/health', async (ctx: RouteContext) => {
    const force = ctx.query.get('probe') === '1';
    const providers = await getAllProviderHealth({ force });
    const payload = { version: API_VERSION, providers };
    assertNoSecretLeak(payload);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(payload));
  });

  /**
   * Phase 2 §3 — resolves a routing MODE (no provider named) into an
   * actual provider/model, without running a chat completion. Lets a
   * future orchestrator (or a human testing routing decisions directly)
   * inspect what BEST/CHEAPEST/FASTEST/LOCAL_ONLY/PRIVATE would actually
   * pick right now, and why — same selectProviderForMode() runChatCompletion
   * itself uses when ChatServiceRequest.mode is set, so this endpoint can
   * never disagree with what a real chat call would have routed to.
   */
  router.post('/v2/route', async (ctx: RouteContext) => {
    const body = (await readJsonBody(ctx.req)) as {
      mode?: RoutingMode;
      provider?: ProviderId;
      needsTools?: boolean;
      needsImages?: boolean;
      needsWebSearch?: boolean;
      route?: string;
    };
    if (!body.mode) throw Errors.validation('الحقل "mode" مطلوب (BEST | CHEAPEST | FASTEST | LOCAL_ONLY | PRIVATE | USER_SELECTED).');
    const routed = await selectProviderForMode({
      mode: body.mode,
      userSelectedProvider: body.provider,
      intent: { needsTools: body.needsTools, needsImages: body.needsImages, needsWebSearch: body.needsWebSearch, route: body.route },
    });
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ version: API_VERSION, mode: body.mode, ...routed }));
  });

  router.get('/v2/observability', async (ctx: RouteContext) => {
    const limit = Math.min(200, Number(ctx.query.get('limit') || '50') || 50);
    const route = ctx.query.get('route') || undefined;
    const recent = getRepos().observability.recent(limit, route);
    const aggregate = getRepos().observability.aggregate(limit);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ version: API_VERSION, recent, aggregate }));
  });

  router.get('/v2/budget', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ version: API_VERSION, ...BudgetGuard.status() }));
  });
}
