// Provider request timeout (NEXUS_TIMEOUT_<PROVIDER>_MS) must actually be enforced on chat()/chatStream(), not only on health probes.
// Found by e2e/real-provider-validation.mjs R4 (silent peer -> /api/chat never answered). Real TCP servers, no mocked fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { withProviderTimeout } from '../src/providers/timeoutFetch.js';
import { normalizeError } from '../src/core/errors.js';

function listen(server: Server): Promise<string> {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
}
const track = (s: Server) => {
  const socks = new Set<import('node:net').Socket>();
  s.on('connection', (x) => socks.add(x));
  return () => { for (const x of socks) x.destroy(); s.close(); };
};

test('silent peer: request rejects with a retryable timeout error near the configured limit', async () => {
  const srv = createServer((req) => { req.resume(); }); // never answers
  const done = track(srv);
  const url = await listen(srv);
  const f = withProviderTimeout(fetch, 300);
  const t0 = Date.now();
  await assert.rejects(f(url, { method: 'POST', body: '{}' }), (e: unknown) => {
    const n = normalizeError(e);
    assert.equal(n.code, 'timeout');
    assert.equal(n.retryable, true);
    return true;
  });
  const ms = Date.now() - t0;
  assert.ok(ms >= 250 && ms < 2500, `elapsed ${ms}ms`);
  done();
});

test('idle stall mid-stream: body read rejects with timeout after the first chunk', async () => {
  const srv = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: first\n\n');
  });
  const done = track(srv);
  const url = await listen(srv);
  const f = withProviderTimeout(fetch, 300);
  const res = await f(url);
  const reader = res.body!.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  await assert.rejects(reader.read(), (e: unknown) => normalizeError(e).code === 'timeout');
  done();
});

test('a healthy long stream is NOT killed: total duration may exceed the timeout while chunks keep arriving', async () => {
  const srv = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let n = 0;
    const iv = setInterval(() => { res.write(`data: ${n}\n\n`); if (++n === 8) { clearInterval(iv); res.end(); } }, 100);
  });
  const done = track(srv);
  const url = await listen(srv);
  const f = withProviderTimeout(fetch, 300); // total ~800ms > 300ms, but gaps are 100ms
  const res = await f(url);
  const text = await res.text();
  assert.match(text, /data: 7/);
  done();
});

test('caller abort still maps to cancellation (not timeout) and is propagated promptly', async () => {
  const srv = createServer((req) => { req.resume(); });
  const done = track(srv);
  const url = await listen(srv);
  const f = withProviderTimeout(fetch, 5000);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const t0 = Date.now();
  await assert.rejects(f(url, { signal: ac.signal }), (e: unknown) => normalizeError(e).code === 'cancelled');
  assert.ok(Date.now() - t0 < 1500);
  done();
});

test('already-aborted signal rejects immediately; timeoutMs<=0 disables the wrapper', async () => {
  const f = withProviderTimeout(fetch, 5000);
  const ac = new AbortController(); ac.abort();
  await assert.rejects(f('http://127.0.0.1:1', { signal: ac.signal }), (e: unknown) => normalizeError(e).code === 'cancelled');
  assert.equal(withProviderTimeout(fetch, 0), fetch);
});

test('fast successful response passes through unchanged (status, headers, body) and leaves no pending timer', async () => {
  const srv = createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json', 'x-test': 'yes' }); res.end('{"ok":true}'); });
  const done = track(srv);
  const url = await listen(srv);
  const f = withProviderTimeout(fetch, 60_000);
  const res = await f(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-test'), 'yes');
  assert.deepEqual(await res.json(), { ok: true });
  done(); // if a 60s timer leaked, node:test would hang past the suite
});

test('non-2xx responses keep their status and body (adapters build provider errors from them)', async () => {
  const srv = createServer((req, res) => { req.resume(); res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"bad key"}}'); });
  const done = track(srv);
  const url = await listen(srv);
  const res = await withProviderTimeout(fetch, 5000)(url);
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.match(await res.text(), /bad key/);
  done();
});
