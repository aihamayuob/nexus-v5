import type { ProviderId } from '../config/providerRegistry.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import type { ToolDef } from '../providers/contract.js';
import { getToolRegistry } from '../tools/registry.js';

export interface CapabilityCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Single source of truth for "is capability X eligible right now" —
 * PermissionModel (capability/permissionModel.ts) calls into this for the
 * capability-existence question; PermissionModel then layers the
 * request-specific authorization (gateway auth, budget) on top. Splitting
 * these two concerns is what the audit flagged as missing: the frontend's
 * CapabilityGraph was real but only ever consulted on one routing path.
 * Here every tool-eligible request goes through the same function.
 */
export const CapabilityGraph = {
  /** Which registered tools a given provider can actually be offered (provider must support tool-calling at all). */
  eligibleToolsForProvider(providerId: ProviderId): ToolDef[] {
    const caps = ProviderRegistry.capabilities(providerId);
    if (!caps.tools) return [];
    return getToolRegistry().list();
  },

  checkToolEligible(providerId: ProviderId, toolName: string): CapabilityCheckResult {
    const caps = ProviderRegistry.capabilities(providerId);
    if (!caps.tools) return { allowed: false, reason: `مزود "${providerId}" لا يدعم استدعاء الأدوات.` };
    const tool = getToolRegistry().get(toolName);
    if (!tool) return { allowed: false, reason: `الأداة "${toolName}" غير مسجّلة.` };
    return { allowed: true };
  },

  checkImageEligible(providerId: ProviderId): CapabilityCheckResult {
    const caps = ProviderRegistry.capabilities(providerId);
    if (!caps.images) return { allowed: false, reason: `مزود "${providerId}" لا يدعم إدخال الصور.` };
    return { allowed: true };
  },

  checkEmbeddingEligible(providerId: ProviderId): CapabilityCheckResult {
    const caps = ProviderRegistry.capabilities(providerId);
    if (!caps.embeddings) return { allowed: false, reason: `مزود "${providerId}" لا يوفر تضمين (embeddings).` };
    return { allowed: true };
  },
};
