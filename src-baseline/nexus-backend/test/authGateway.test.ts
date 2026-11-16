import './helpers/setAuthTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

let server: Server;
let url: string;

before(async () => {
  server = createNexusServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  url = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('protected route rejects a request with no Authorization header', async () => {
  const res = await fetch(`${url}/v2/models`);
  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.error.code, 'auth_error');
});

test('protected route rejects an invalid bearer token', async () => {
  const res = await fetch(`${url}/v2/models`, { headers: { Authorization: 'Bearer wrong-token' } });
  assert.equal(res.status, 401);
});

test('protected route accepts a valid configured bearer token', async () => {
  const res = await fetch(`${url}/v2/models`, { headers: { Authorization: 'Bearer secret-key-abc' } });
  assert.equal(res.status, 200);
});

test('protected route accepts the SECOND configured key too (multi-key support)', async () => {
  const res = await fetch(`${url}/v2/models`, { headers: { Authorization: 'Bearer another-key-xyz' } });
  assert.equal(res.status, 200);
});

test('a route explicitly marked skipAuth (health) works with NO token even when gateway keys ARE configured', async () => {
  const res = await fetch(`${url}/v2/health`);
  assert.equal(res.status, 200);
});

// F-01 (owner-authorized 2026-11-14): the legacy /api/embed route is NO LONGER public. It forwards the caller's text to an embeddings provider
// (possibly a paid cloud one), so once gateway keys are configured it must be authenticated like every other non-health route.
test('F-01: /api/embed REJECTS a request with no token when gateway keys are configured (401 auth_error)', async () => {
  const res = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts: ['x'] }),
  });
  assert.equal(res.status, 401);
  const body = (await res.json()) as any;
  assert.equal(body.error.code, 'auth_error');
});

test('F-01: /api/embed REJECTS an invalid bearer token (401)', async () => {
  const res = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-token' },
    body: JSON.stringify({ texts: ['x'] }),
  });
  assert.equal(res.status, 401);
});

test('F-01: /api/embed with a VALID token passes authentication (the request then fails on provider configuration, not on auth)', async () => {
  const res = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret-key-abc' },
    body: JSON.stringify({ texts: ['x'] }),
  });
  // No embeddings-capable provider is configured in this test env => capability_denied (not 401): authentication is no longer the blocker.
  assert.notEqual(res.status, 401);
  assert.notEqual(res.status, 200);
});
