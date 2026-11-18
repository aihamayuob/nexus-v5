// Finding (2026-11-18, perf-smoke phase 1): 300 consecutive unauthenticated requests to a protected route were ALL answered 401 and never throttled —
// authenticate() threw before checkRateLimit() ran, so gateway-key guessing was unlimited per client IP. Failed authentication now consumes a token
// from a per-IP `authfail:<ip>` bucket; once empty the answer is 429 (still no information about which keys exist). Valid-key traffic is unaffected.
import './helpers/setAuthThrottleTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { resetRateLimitBucketsForTests } from '../src/gateway/middleware/rateLimit.js';

let server: Server;
let url: string;
before(async () => {
  server = createNexusServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
after(async () => { await new Promise((r) => server.close(r)); });
beforeEach(() => resetRateLimitBucketsForTests());

async function codes(n: number, headers: Record<string, string> = {}) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const r = await fetch(`${url}/v2/warden/status`, { headers }); await r.arrayBuffer(); out.push(r.status); }
  return out;
}

test('repeated wrong-key attempts: the first ones are 401, then the per-IP failure bucket empties and the answer becomes 429', async () => {
  const c = await codes(40, { Authorization: 'Bearer wrong-token-0123456789' });
  assert.equal(c[0], 401);
  assert.ok(c.includes(429), `expected a 429 after the burst, got ${JSON.stringify(c)}`);
  assert.ok(c.filter((x) => x === 401).length <= 15, 'a burst of ~10 failures is tolerated, not dozens');
});

test('missing-credential attempts draw from the same failure bucket', async () => {
  const c = await codes(40);
  assert.ok(c.includes(429), `expected a 429, got ${JSON.stringify(c)}`);
});

test('a throttled attacker does NOT lock out a legitimate key from the same IP (valid keys use their own bucket)', async () => {
  await codes(40, { Authorization: 'Bearer wrong-token-0123456789' });
  const ok = await fetch(`${url}/v2/warden/status`, { headers: { Authorization: 'Bearer secret-key-abc-0123456789' } });
  assert.equal(ok.status, 200);
});

test('a few typos are tolerated: 3 wrong attempts then a correct one all behave normally (401,401,401,200)', async () => {
  const bad = await codes(3, { Authorization: 'Bearer typo-0123456789abcdef' });
  assert.deepEqual(bad, [401, 401, 401]);
  const ok = await fetch(`${url}/v2/warden/status`, { headers: { Authorization: 'Bearer another-key-xyz-0123456789' } });
  assert.equal(ok.status, 200);
});

test('the 429 body does not reveal whether a key exists (same shape for a near-miss and garbage)', async () => {
  await codes(30, { Authorization: 'Bearer wrong-token-0123456789' });
  const a = await fetch(`${url}/v2/warden/status`, { headers: { Authorization: 'Bearer secret-key-abc-012345678X' } });
  const b = await fetch(`${url}/v2/warden/status`, { headers: { Authorization: 'Bearer zzzzzzzzzzzzzzzzzzzz' } });
  assert.equal(a.status, 429); assert.equal(b.status, 429);
  // retryAfterMs is a legitimate dynamic field (time until the next token); every other byte of the body must be identical.
  const strip = (o: any) => { const c = JSON.parse(JSON.stringify(o)); delete c.error?.details?.retryAfterMs; return c; };
  assert.deepEqual(strip(await a.json()), strip(await b.json()));
});
