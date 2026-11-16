import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { embedTexts } from '../../memory/embeddingsService.js';
import { ProviderRegistry, type ProviderId } from '../../config/providerRegistry.js';
import { Errors } from '../../core/errors.js';

export function registerEmbedRoutes(router: Router) {
  router.post(
    '/api/embed',
    async (ctx: RouteContext) => {
      const body = await readJsonBody<{ texts?: string[]; provider?: string; model?: string; localOnly?: unknown }>(ctx.req);
      if (!Array.isArray(body.texts) || body.texts.length === 0) throw Errors.validation('الحقل "texts" مطلوب ويجب أن يكون مصفوفة غير فارغة.');
      if (body.texts.some((t) => typeof t !== 'string')) throw Errors.validation('كل عنصر في "texts" يجب أن يكون نصاً.');
      // F-UI-1: the frontend's 🔒 local mode sends `localOnly:true`. It can only TIGHTEN the route: only a LOCAL provider may be chosen, an
      // explicit cloud provider is refused, and there is no fallback to a cloud embedder. A non-boolean value is rejected, never read as false.
      if (body.localOnly !== undefined && typeof body.localOnly !== 'boolean') throw Errors.validation('الحقل "localOnly" يجب أن يكون قيمة منطقية (true/false).');
      const localOnly = body.localOnly === true;
      // The frontend's current getEmbedding() call doesn't send a
      // provider — default to the first embeddings-capable configured
      // provider so the legacy contract keeps working unmodified while
      // still routing through the SAME unified service future callers
      // (that DO specify a provider) use.
      const providerId = (body.provider && ProviderRegistry.has(body.provider) ? body.provider : firstEmbeddingProvider(localOnly)) as ProviderId;
      if (localOnly && !ProviderRegistry.resolve(providerId).capabilities.isLocal) {
        throw Errors.capabilityDenied('وضع المحادثة المحلي مفعّل: لا يُسمح بإرسال النص إلى مزود تضمين سحابي. لم يُرسَل أي محتوى إلى مزود سحابي.');
      }
      const result = await embedTexts(body.texts, providerId, ctx.gw, body.model);
      ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ embeddings: result.embeddings }));
    }
    // F-01 (owner-authorized 2026-11-14): NOT skipAuth any more. This route forwards the caller's text to an embeddings provider (possibly a paid
    // cloud one) — with gateway keys configured it requires a valid Bearer key like every other non-health route (no-keys loopback mode is unchanged).
    // The frontend's getEmbedding() now sends the same Authorization header the rest of the app sends.
  );
}

function firstEmbeddingProvider(localOnly = false): ProviderId {
  const candidates = ProviderRegistry.resolveAll().filter((p) => p.capabilities.embeddings && (p.capabilities.isLocal || (!localOnly && p.apiKey)));
  if (candidates.length === 0) throw Errors.capabilityDenied(localOnly ? 'لا يوجد مزود تضمين محلي مُعدّ على السيرفر (وضع المحادثة المحلي يمنع المزودات السحابية).' : 'لا يوجد أي مزود تضمين (embeddings) مُعدّ على السيرفر.');
  return candidates[0]!.id;
}
