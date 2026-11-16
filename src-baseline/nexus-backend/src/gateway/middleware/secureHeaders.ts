import type { ServerResponse } from 'node:http';

/**
 * This backend serves JSON/SSE only — it never serves HTML, so the CSP
 * below is deliberately maximally restrictive (default-src 'none') rather
 * than tuned for a page that needs scripts/styles/images. If this process
 * is ever extended to also serve the frontend's static HTML directly, THAT
 * route (and only that route) needs its own, more permissive CSP — this
 * one should stay locked down for every API/SSE response.
 */
export function applySecureHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // HSTS only makes sense once actually served over HTTPS (typically via a
  // reverse proxy in front of this process) — harmless to always send;
  // browsers ignore it on a plain-HTTP response.
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
}
