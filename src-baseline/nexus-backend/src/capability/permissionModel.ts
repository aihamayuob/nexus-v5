import type { ProviderId } from '../config/providerRegistry.js';
import { CapabilityGraph } from './capabilityGraph.js';
import { BudgetGuard } from '../orchestrator/budget.js';
import { Errors } from '../core/errors.js';
import { auditSecurityEvent } from '../security/audit.js';

/**
 * Production Hardening (deliberate, documented decision — not a gap):
 * NEXUS is currently a genuinely SINGLE-TENANT system by design. Every
 * entry in NEXUS_GATEWAY_KEYS authenticates as an equally-trusted holder
 * of the same deployment — there is no per-key identity, and
 * authenticate() (gateway/middleware/auth.ts) always returns
 * projectId: null, userId: null for every request, regardless of which
 * key was used. No route anywhere in this codebase checks a resource's
 * projectId/userId against the caller's — a mission, council session,
 * genome, schedule, or memory item created under one key is fully
 * readable and mutable by any other valid key. This was verified
 * end-to-end (every route grepped, zero ownership comparisons found
 * anywhere) during a Production Hardening pass and confirmed with Aiham
 * as the intended model for this deployment: every key holder IS Aiham
 * (or someone he equally trusts with the whole deployment), not
 * distinct, mutually-untrusted tenants.
 *
 * projectId/userId exist on GatewayContext and on several tables
 * (tasks.project_id, etc.) for organizing/filtering data — NOT as an
 * access-control boundary. If that ever changes (distinct gateway keys
 * issued to genuinely separate, mutually-untrusted users/teams sharing
 * one deployment), every route that reads or mutates a resource by ID
 * would need a real ownership check added — this comment is the marker
 * for exactly where that decision was made and why it wasn't done here.
 */
export interface GatewayContext {
  authenticated: boolean;
  clientKey: string; // derived id ("key:<16 hex>" for a keyed request — NEVER the raw gateway key — or the client IP in trusted mode) — used for rate limiting and audit-log attribution ONLY, never as a resource-ownership boundary (see this file's header comment)
  /** Release V1 · B4: sha256(hex) of the raw gateway key, set only for keyed requests. Exists solely so /api/sync keeps addressing the SAME stored records it always did (previously sha256(clientKey) with clientKey = raw key). Not for logging. */
  ownerKey?: string;
  projectId: string | null;
  userId: string | null;
}

/**
 * The one place a request's "am I actually allowed to do this" question
 * gets answered, combining: (1) CapabilityGraph's provider/tool
 * eligibility, (2) budget status, (3) gateway auth context. Every route
 * that dispatches to a tool or an image-bearing chat call goes through
 * this — not just the fast auto-route path, which was the gap the
 * frontend audit found in the old CapabilityGraph usage.
 */
export const PermissionModel = {
  assertToolAllowed(providerId: ProviderId, toolName: string, _ctx: GatewayContext): void {
    const check = CapabilityGraph.checkToolEligible(providerId, toolName);
    if (!check.allowed) {
      auditSecurityEvent('warn', 'Tool permission denied', { providerId, toolName, reason: check.reason });
      throw Errors.toolPermissionDenied(check.reason!);
    }
  },

  assertImageAllowed(providerId: ProviderId, _ctx: GatewayContext): void {
    const check = CapabilityGraph.checkImageEligible(providerId);
    if (!check.allowed) throw Errors.capabilityDenied(check.reason!);
  },

  assertEmbeddingAllowed(providerId: ProviderId, _ctx: GatewayContext): void {
    const check = CapabilityGraph.checkEmbeddingEligible(providerId);
    if (!check.allowed) throw Errors.capabilityDenied(check.reason!);
  },

  assertBudgetAllowed(): void {
    BudgetGuard.assertWithinBudget();
  },
};
