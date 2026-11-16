import './helpers/setSecurityTestEnv.js';
// Release V1 · B4 (G6): security headers asserted on REAL HTTP responses (200, 401, 404, 429), not on the helper function.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

let server: Server;
let url: string;
const KEY = 'LAN-test-key-aaaaaaaaaaaa-0001';

before(async () => {
  server = createNexusServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const EXPECTED: Record<string, string> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-site',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
  'x-permitted-cross-domain-policies': 'none',
};

function assertSecureHeaders(res: Response, label: string) {
  for (const [name, value] of Object.entries(EXPECTED)) {
    assert.equal(res.headers.get(name), value, `${label}: header ${name}`);
  }
  assert.equal(res.headers.get('access-control-allow-origin'), null, `${label}: no CORS header without an allow-listed Origin`);
  assert.equal(res.headers.get('x-powered-by'), null, `${label}: no x-powered-by`);
}

test('G6 secure headers on a real 200 response (public health route)', async () => {
  const res = await fetch(`${url}/v2/health`);
  assert.equal(res.status, 200);
  assertSecureHeaders(res, '200');
});

test('G6 secure headers on a real 401 response (missing key)', async () => {
  const res = await fetch(`${url}/v2/models`);
  assert.equal(res.status, 401);
  assertSecureHeaders(res, '401');
});

test('G6 secure headers on a real 404 response', async () => {
  const res = await fetch(`${url}/definitely-not-a-route`);
  assert.equal(res.status, 404);
  assertSecureHeaders(res, '404');
});

test('G6 an Origin that is not allow-listed gets no CORS grant even with a valid key', async () => {
  const res = await fetch(`${url}/v2/models`, { headers: { Authorization: `Bearer ${KEY}`, Origin: 'http://evil.example' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('G6 secure headers on a real 429 response (rate limit actually exceeded)', async () => {
  let last: Response | null = null;
  for (let i = 0; i < 12; i++) {
    last = await fetch(`${url}/v2/models`, { headers: { Authorization: `Bearer ${KEY}` } });
    if (last.status === 429) break;
  }
  assert.equal(last!.status, 429, 'burst of 5 must be exceeded within 12 requests');
  assertSecureHeaders(last!, '429');
});
