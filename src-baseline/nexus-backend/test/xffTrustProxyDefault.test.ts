// F06-a (owner mandate 2026-11-16): X-Forwarded-For must NOT define client identity unless the TCP peer is an explicitly trusted proxy.
// Default (NEXUS_TRUST_PROXY unset) => header ignored. Keyless mode => identity is the socket address, so rotating the header cannot dodge the rate limiter.
import './helpers/setXffTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';
import { resetRateLimitBucketsForTests } from '../src/gateway/middleware/rateLimit.js';

let server: Server; let url: string;
before(async () => {
  server = createNexusServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const codes = async (hdr: (i: number) => Record<string, string>) => {
  resetRateLimitBucketsForTests();
  const o: number[] = [];
  for (let i = 0; i < 12; i++) o.push((await fetch(`${url}/v2/models`, { headers: hdr(i) })).status);
  return o;
};

test('F06-a: with NEXUS_TRUST_PROXY unset, rotating X-Forwarded-For does NOT escape the per-client rate limit', async () => {
  const rotating = await codes((i) => ({ 'X-Forwarded-For': `10.9.8.${i}` }));
  assert.ok(rotating.includes(429), `rotating XFF must still be rate-limited (all share the socket identity); got ${rotating.join(',')}`);
});

test('F06-a: a fixed client is still limited (control — burst budget is finite)', async () => {
  const same = await codes(() => ({}));
  assert.ok(same.includes(429));
});
