import type { IncomingMessage, ServerResponse } from 'node:http';
import { authenticate, clientIp } from './middleware/auth.js';
import { checkRateLimit } from './middleware/rateLimit.js';
import { applyCors } from './middleware/cors.js';
import { applySecureHeaders } from './middleware/secureHeaders.js';
import { normalizeError } from '../core/errors.js';
import { logger } from '../core/logger.js';
import type { GatewayContext } from '../capability/permissionModel.js';

export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  gw: GatewayContext;
}

export type RouteHandler = (ctx: RouteContext) => Promise<void>;

interface Route {
  method: string;
  segments: string[]; // '' for literal match check via index, ':name' for params
  handler: RouteHandler;
  skipAuth?: boolean;
  skipRateLimit?: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler, opts: { skipAuth?: boolean; skipRateLimit?: boolean } = {}) {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler, ...opts });
  }

  get(path: string, handler: RouteHandler, opts?: { skipAuth?: boolean }) {
    this.add('GET', path, handler, opts);
  }
  post(path: string, handler: RouteHandler, opts?: { skipAuth?: boolean }) {
    this.add('POST', path, handler, opts);
  }
  put(path: string, handler: RouteHandler, opts?: { skipAuth?: boolean }) {
    this.add('PUT', path, handler, opts);
  }
  // Restoration-pass fix: the frontend's schedule enable/disable toggle
  // (renderScheduleItem()'s checkbox -> toggleSchedule()) has always sent
  // `PATCH /api/schedules/:id` — but Router never had a .patch() convenience
  // method, so that route could never be registered at all (add() itself is
  // method-agnostic and was always ready for this). scheduleRepo.setEnabled()
  // already existed too — only the HTTP wiring was missing end-to-end. See
  // routes/legacy/schedules.ts for the new route this unblocks.
  patch(path: string, handler: RouteHandler, opts?: { skipAuth?: boolean }) {
    this.add('PATCH', path, handler, opts);
  }
  delete(path: string, handler: RouteHandler, opts?: { skipAuth?: boolean }) {
    this.add('DELETE', path, handler, opts);
  }

  private match(method: string, pathSegments: string[]): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const routeSeg = route.segments[i]!;
        const pathSeg = pathSegments[i]!;
        if (routeSeg.startsWith(':')) params[routeSeg.slice(1)] = decodeURIComponent(pathSeg);
        else if (routeSeg !== pathSeg) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    applySecureHeaders(res);
    if (applyCors(req, res)) return;
    const url = new URL(req.url || '/', 'http://internal');
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const matched = this.match(req.method || 'GET', pathSegments);

    if (!matched) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'المسار غير موجود.', code: 'not_found' } }));
      return;
    }

    try {
      // Production Hardening: a skipAuth route (health check, legacy embed
      // endpoint) must NOT share one literal 'public' rate-limit bucket
      // and audit-log identity across every anonymous caller — that both
      // lets one caller silently exhaust the shared quota for everyone
      // else, and destroys per-caller attribution in security audit logs.
      // Keying by real client IP fixes both, with zero change to the
      // authenticated path (which already keys on the real bearer token).
      const gw = matched.route.skipAuth ? { authenticated: true, clientKey: `public:${clientIp(req)}`, projectId: null, userId: null } : authenticate(req);
      if (!matched.route.skipRateLimit) checkRateLimit(gw.clientKey);
      await matched.route.handler({ req, res, params: matched.params, query: url.searchParams, gw });
    } catch (e) {
      const err = normalizeError(e);
      logger.warn('Request failed', { path: url.pathname, status: err.status, code: err.code, message: err.logDetail ?? err.message });
      if (!res.headersSent) {
        res.writeHead(err.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(err.toHttpBody()));
      } else {
        try {
          res.end();
        } catch {
          /* connection already closed */
        }
      }
    }
  }
}
