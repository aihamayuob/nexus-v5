// F06-a: when the operator explicitly lists the proxy peer (here: loopback, which is the test client), X-Forwarded-For is honoured
// so a real reverse proxy in front of NEXUS still gets per-client buckets.
import './helpers/setXffTrustTestEnv.js';
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

test('F06-a: trusted proxy peer => distinct forwarded clients get independent buckets; one forwarded client is still limited', async () => {
  resetRateLimitBucketsForTests();
  const distinct: number[] = [];
  for (let i = 0; i < 12; i++) distinct.push((await fetch(`${url}/v2/models`, { headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` } })).status);
  assert.ok(!distinct.includes(429), `12 different forwarded clients must each have their own budget; got ${distinct.join(',')}`);
  const one: number[] = [];
  for (let i = 0; i < 12; i++) one.push((await fetch(`${url}/v2/models`, { headers: { 'X-Forwarded-For': '203.0.113.200' } })).status);
  assert.ok(one.includes(429), `one forwarded client must exhaust its own bucket; got ${one.join(',')}`);
});
