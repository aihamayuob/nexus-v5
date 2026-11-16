import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { getAllProviderHealth } from './healthRegistry.js';
import { estimateCostUsd } from '../orchestrator/budget.js';
import { rankFallbacks } from './adaptiveModelRouter.js';
import { routeModel, type RouteIntent, type RoutedModel } from './modelRouter.js';
import { Errors } from '../core/errors.js';

/**
 * NEXUS Phase 2 §3's six routing modes. USER_SELECTED is the existing,
 * already-shipped behavior of routeModel() (a human/frontend names the
 * provider; this backend never overrides that — see modelRouter.ts's own
 * doc comment) exposed here under its Phase-2 name so callers can request
 * any mode through one entry point. The other five are new: the
 * orchestrator asks for an OUTCOME ("cheapest", "fastest"...) instead of
 * naming a provider, for use by autonomous multi-step execution where
 * there is no human in the loop to have picked one.
 */
export type RoutingMode = 'BEST' | 'CHEAPEST' | 'FASTEST' | 'LOCAL_ONLY' | 'PRIVATE' | 'USER_SELECTED';

export interface ModeRouteRequest {
  mode: RoutingMode;
  intent?: RouteIntent;
  /** Required only for USER_SELECTED — ignored otherwise, since every other mode picks the provider itself. */
  userSelectedProvider?: ProviderId;
}

function baseEligibleCandidates(intent: RouteIntent): ProviderId[] {
  return ProviderRegistry.resolveAll()
    .filter((p) => (p.capabilities.isLocal ? !!p.resolvedModel : !!p.apiKey))
    .filter((p) => !intent.needsTools || p.capabilities.tools)
    .filter((p) => !intent.needsImages || p.capabilities.images)
    .filter((p) => !intent.needsWebSearch || p.capabilities.webSearch)
    .map((p) => p.id);
}

/** Rough $/1K-token ranking score. Reuses budget.ts's SAME rate table used for real spend tracking (a fixed representative 500/500 token split) — this is a RANKING heuristic only, never surfaced as an actual cost estimate for a specific request. */
function cheapnessScore(id: ProviderId): number {
  return estimateCostUsd(id, 500, 500);
}

/**
 * Resolves a RoutingMode + intent into an actual provider/model — the
 * autonomous-execution counterpart to routeModel() (which requires a
 * caller-named provider). Every mode still ends by calling routeModel()
 * for the winning provider, so capability validation, the configured-key
 * check, and AdaptiveModelRouter-ranked fallbacks are identical to the
 * existing, already-tested path — this module only decides WHICH
 * provider to hand routeModel(), never re-implements what happens after.
 */
export async function selectProviderForMode(req: ModeRouteRequest): Promise<RoutedModel> {
  const intent = req.intent ?? {};

  if (req.mode === 'USER_SELECTED') {
    if (!req.userSelectedProvider) {
      throw Errors.validation('وضع USER_SELECTED يتطلب تمرير userSelectedProvider صراحة.');
    }
    return routeModel(req.userSelectedProvider, intent);
  }

  let candidates = baseEligibleCandidates(intent);

  if (req.mode === 'LOCAL_ONLY' || req.mode === 'PRIVATE') {
    // PRIVATE is intentionally identical to LOCAL_ONLY today: the
    // provider registry has no separate "cloud provider with a stronger
    // data-handling/no-retention guarantee" tier yet to distinguish them
    // honestly. Documented here rather than silently faking two distinct
    // behaviors — a real PRIVATE tier is a registry-schema change, not a
    // routing-logic one, and belongs in a dedicated follow-up.
    candidates = candidates.filter((id) => ProviderRegistry.resolve(id).capabilities.isLocal);
  }

  if (candidates.length === 0) {
    throw Errors.validation(`لا يوجد أي مزود مؤهل حاليًا لوضع التوجيه "${req.mode}" بعد تصفية القدرات/الإعداد.`);
  }

  if (req.mode === 'CHEAPEST') {
    const winner = [...candidates].sort((a, b) => cheapnessScore(a) - cheapnessScore(b))[0]!;
    return routeModel(winner, intent);
  }

  if (req.mode === 'LOCAL_ONLY' || req.mode === 'PRIVATE') {
    // No meaningful cost/latency ranking signal for local providers yet
    // (health-registry latency covers this — see FASTEST — but LOCAL_ONLY/
    // PRIVATE are about ELIGIBILITY, not speed) — first eligible candidate,
    // in registry declaration order, same tie-break routeModel() itself uses.
    return routeModel(candidates[0]!, intent);
  }

  if (req.mode === 'FASTEST') {
    const health = await getAllProviderHealth();
    const healthMap = new Map(health.map((h) => [h.id, h]));
    const ranked = candidates
      .map((id) => ({ id, h: healthMap.get(id) }))
      // Never route FASTEST to a provider we just confirmed is UNAVAILABLE
      // or NOT_CONFIGURED, no matter how fast it looked historically.
      .filter((c): c is { id: ProviderId; h: NonNullable<typeof c.h> } => !!c.h && (c.h.state === 'READY' || c.h.state === 'DEGRADED'))
      .sort((a, b) => (a.h.latencyMs ?? Infinity) - (b.h.latencyMs ?? Infinity));
    if (ranked.length === 0) {
      throw Errors.validation('لا يوجد مزود بحالة READY أو DEGRADED فعليًا حاليًا لوضع FASTEST — راجع GET /v2/providers/health.');
    }
    return routeModel(ranked[0]!.id, intent);
  }

  // BEST: live-health-eligible candidates, ranked by AdaptiveModelRouter's
  // real evidence (success rate / latency / cost / verification pass rate
  // / user feedback — see adaptiveModelRouter.ts) exactly like routeModel()
  // ranks its OWN fallback chain, so "best" and "best fallback order" can
  // never disagree. Cold-start-safe: with no evidence yet, falls back to
  // registry declaration order, same as everywhere else in this codebase.
  const health = await getAllProviderHealth();
  const healthMap = new Map(health.map((h) => [h.id, h]));
  const readyCandidates = candidates.filter((id) => healthMap.get(id)?.state === 'READY');
  // Degrade gracefully rather than hard-fail if nothing is confirmed READY
  // yet (e.g. right after startup, before any probe has run) — fall back
  // to the full eligible set rather than blocking BEST entirely.
  const pool = readyCandidates.length > 0 ? readyCandidates : candidates;
  const ranked = rankFallbacks(pool, intent.route);
  return routeModel(ranked[0]!, intent);
}
