// Needs NEXUS_CORS_ORIGINS set before env.js (and therefore cors.js) is ever
// imported, since ServerConfig reads process.env once at module load. This
// MUST be a bare side-effect import listed first — a plain `process.env.X =`
// statement written above the other imports would NOT work here: ES module
// imports are hoisted and always run before any other statement in the
// importing file, regardless of source order (see every other
// setXxxTestEnv.ts helper in this suite for the same established pattern —
// and see this file's own git history for a first draft that got this
// exact ordering wrong).
import '../test/helpers/setCorsTestEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyCors } from '../src/gateway/middleware/cors.js';

function fakeReqRes(method: string, origin: string) {
  const headers: Record<string, string> = {};
  const req = { headers: { origin } } as unknown as IncomingMessage;
  let statusCode: number | undefined;
  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    writeHead: (code: number) => {
      statusCode = code;
    },
    end: () => {},
  } as unknown as ServerResponse;
  (req as { method?: string }).method = method;
  return { req, res, headers, getStatus: () => statusCode };
}

// Restoration-pass fix under test: PATCH was missing from this header
// entirely (Access-Control-Allow-Methods used to list only GET/POST/PUT/
// DELETE/OPTIONS) — added alongside Router's new .patch() and the new real
// PATCH /api/schedules/:id route it unblocks. Without this, even a correctly
// registered PATCH route would still fail a real browser's CORS preflight
// for any cross-origin backendUrl setup, which is the frontend's normal
// deployment shape (a standalone HTML file + a separately-hosted backend).
test('CORS preflight for an allowed origin now includes PATCH in Access-Control-Allow-Methods', () => {
  const { req, res, headers } = fakeReqRes('OPTIONS', 'http://localhost:9999');
  applyCors(req, res);
  assert.match(headers['Access-Control-Allow-Methods'] ?? '', /\bPATCH\b/);
  // Regression guard: every method that already worked must still be listed.
  for (const m of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.match(headers['Access-Control-Allow-Methods'] ?? '', new RegExp(`\\b${m}\\b`));
  }
});

test('a real OPTIONS preflight request is still answered with 204 (unchanged by this fix)', () => {
  const { req, res, getStatus } = fakeReqRes('OPTIONS', 'http://localhost:9999');
  const handled = applyCors(req, res);
  assert.equal(handled, true);
  assert.equal(getStatus(), 204);
});
