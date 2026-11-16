import { ProviderRegistry, type ProviderId } from '../config/providerRegistry.js';
import { Errors } from '../core/errors.js';
import { rankFallbacks } from './adaptiveModelRouter.js';

export interface RouteIntent {
  /** Rough cost/quality tradeoff hint — read by executionPolicy.ts to pick a fast-path vs. multi-agent pipeline. */
  risk?: 'low' | 'medium' | 'high';
  complexity?: 'low' | 'medium' | 'high';
  /** true if the request needs tool-calling support. */
  needsTools?: boolean;
  /** true if the request includes image input. */
  needsImages?: boolean;
  /** true if the request asked for a live-web-search-grounded answer (ChatRequest.webSearch). */
  needsWebSearch?: boolean;
  /** "Task type" bucket for AdaptiveModelRouter evidence lookup — e.g. 'chat', 'runtime_plan'. */
  route?: string;
}

export interface RoutedModel {
  provider: ProviderId;
  model: string;
  /** Ordered fallback providers to try if the primary fails — same capability class, so a fallback never silently downgrades what the request actually needs. Ordered by AdaptiveModelRouter evidence when enough history exists, otherwise by registry declaration order. */
  fallbacks: ProviderId[];
  /**
   * GAP-1 (owner decisions D1/D2, 2026-10-18): true when the primary is a LOCAL provider, in which case cloud providers were deliberately
   * excluded from `fallbacks` (a request routed locally never leaves the machine through this router, silently or otherwise). Lets
   * chatService turn "the local provider failed" into a clear, testable error instead of a silent cloud hop.
   */
  cloudFallbackBlocked: boolean;
}

/**
 * Resolves which provider/model actually serves a request. The caller
 * always gets to name their preferred provider explicitly (this backend
 * never overrides an explicit user choice — see the frontend audit's own
 * finding about respecting getChatModel()); this function's job is (a)
 * validating that choice is actually usable for what the request needs,
 * and (b) building a sensible fallback chain from providers that ARE
 * configured and DO have the required capability, entirely from registry
 * metadata — no provider/model name is ever written here directly. The
 * ORDER of that fallback chain is where AdaptiveModelRouter's evidence
 * comes in (see rankFallbacks) — which candidates are eligible is still
 * decided purely by registry capability/configuration, never by evidence.
 */
export function routeModel(preferredProvider: ProviderId, intent: RouteIntent = {}): RoutedModel {
  if (!ProviderRegistry.has(preferredProvider)) throw Errors.validation(`مزود غير معروف: ${preferredProvider}`);

  const preferred = ProviderRegistry.resolve(preferredProvider);
  if (!preferred.capabilities.isLocal && !preferred.apiKey) {
    throw Errors.validation(`مزود "${preferredProvider}" يحتاج مفتاح API مُعدّ على السيرفر.`);
  }
  if (intent.needsTools && !preferred.capabilities.tools) {
    throw Errors.capabilityDenied(`مزود "${preferredProvider}" لا يدعم استدعاء الأدوات.`);
  }
  if (intent.needsImages && !preferred.capabilities.images) {
    throw Errors.capabilityDenied(`مزود "${preferredProvider}" لا يدعم إدخال الصور.`);
  }
  if (intent.needsWebSearch && !preferred.capabilities.webSearch) {
    throw Errors.capabilityDenied(`مزود "${preferredProvider}" لا يدعم تأصيل الإجابة ببحث ويب حي (Google Search grounding).`);
  }
  if (preferred.capabilities.isLocal && !preferred.resolvedModel) {
    throw Errors.validation(`حدد اسم نموذج محلي لمزود "${preferredProvider}" أولاً.`);
  }

  const eligible = ProviderRegistry.resolveAll()
    .filter((p) => p.id !== preferredProvider)
    .filter((p) => p.capabilities.isLocal || !!p.apiKey) // only fall back to something actually configured
    .filter((p) => !intent.needsTools || p.capabilities.tools)
    .filter((p) => !intent.needsImages || p.capabilities.images)
    .filter((p) => !intent.needsWebSearch || p.capabilities.webSearch)
    .filter((p) => !p.capabilities.isLocal || !!p.resolvedModel)
    // GAP-1 root cause: this chain used to include every configured provider, so a request routed to a LOCAL provider (LOCAL_ONLY / PRIVATE
    // mode, or an explicit local choice such as provider:"ollama") was silently re-sent to a CLOUD provider whenever the local one failed.
    // Invariant (D1): a local primary only ever falls back to other local providers. There is intentionally NO opt-in in this slice —
    // an explicit, visible, logged opt-in channel needs an owner decision (see the slice report); until then cloud fallback is impossible.
    .filter((p) => !preferred.capabilities.isLocal || p.capabilities.isLocal)
    .map((p) => p.id);

  const fallbacks = rankFallbacks(eligible, intent.route);

  return { provider: preferredProvider, model: preferred.resolvedModel, fallbacks, cloudFallbackBlocked: preferred.capabilities.isLocal };
}

/** Public capability + configuration metadata for every provider — backs GET /v2/models. Never includes API keys (see security/secrets.ts). */
export function listModelsMetadata() {
  return ProviderRegistry.publicMetadata();
}
