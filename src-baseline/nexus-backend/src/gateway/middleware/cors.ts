import type { IncomingMessage, ServerResponse } from 'node:http';
import { ServerConfig } from '../../config/env.js';

/** Returns true if the request was a handled OPTIONS preflight (caller should stop processing). */
export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (ServerConfig.corsAllowedOrigins.length > 0 && origin && ServerConfig.corsAllowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Last-Event-ID');
    // PATCH added alongside Router's new .patch() convenience method — see
    // its comment: the frontend's schedule enable/disable toggle has always
    // sent PATCH, which would fail CORS preflight for any cross-origin
    // backendUrl setup even once the route itself existed.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}
