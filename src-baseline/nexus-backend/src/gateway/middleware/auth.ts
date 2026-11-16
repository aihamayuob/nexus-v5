import type { IncomingMessage } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ServerConfig } from '../../config/env.js';
import { Errors } from '../../core/errors.js';
import type { GatewayContext } from '../../capability/permissionModel.js';
import { auditSecurityEvent } from '../../security/audit.js';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function extractBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

/**
 * Release V1 · B4: the raw bearer token must never become an identity that is
 * logged or persisted (rate-limit audit, approvals.decided_by, ...). A keyed
 * request is identified by a one-way, stable, per-key derived id instead.
 */
export function keyIdentity(token: string): string {
  return 'key:' + createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Trusted/no-auth mode when NEXUS_GATEWAY_KEYS is empty (self-hosted
 * LAN deployment) — matches the frontend's existing behavior of only
 * sending the Authorization header when a key is actually configured
 * client-side. Any key configured server-side makes auth mandatory; there
 * is no "accept if present, ignore if absent" middle state that would
 * silently let an unauthenticated request through once a key exists.
 *
 * Deliberately single-tenant (confirmed with Aiham during a Production
 * Hardening pass, not an oversight): every valid key authenticates as an
 * equally-trusted holder of the WHOLE deployment — projectId/userId are
 * always returned null here, on purpose, for every request regardless of
 * which key matched. See capability/permissionModel.ts's GatewayContext
 * header comment for the full reasoning and what would need to change if
 * this deployment ever needs genuinely separate, mutually-untrusted
 * identities sharing one instance.
 */
export function authenticate(req: IncomingMessage): GatewayContext {
  const ip = clientIp(req);
  if (ServerConfig.gatewayKeys.length === 0) {
    return { authenticated: true, clientKey: ip, projectId: null, userId: null };
  }
  const token = extractBearer(req);
  if (!token) {
    auditSecurityEvent('warn', 'Auth failed: missing Bearer token', { ip, path: req.url });
    throw Errors.auth();
  }
  const matched = ServerConfig.gatewayKeys.some((k) => safeCompare(k, token));
  if (!matched) {
    auditSecurityEvent('warn', 'Auth failed: invalid gateway key', { ip, path: req.url });
    throw Errors.auth();
  }
  return { authenticated: true, clientKey: keyIdentity(token), ownerKey: createHash('sha256').update(token).digest('hex'), projectId: null, userId: null };
}
