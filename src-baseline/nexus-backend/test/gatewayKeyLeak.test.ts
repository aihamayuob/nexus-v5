import './helpers/setSecurityTestEnv.js';
// Release V1 · B4 (G4/G5): the raw gateway key must not leak into logs, the audit table, or approvals.decided_by.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { createNexusServer } from '../src/gateway/server.js';
import { authenticate } from '../src/gateway/middleware/auth.js';
import { getRepos } from '../src/persistence/repos.js';

const KEY1 = 'LAN-test-key-aaaaaaaaaaaa-0001';
const KEY2 = 'LAN-test-key-bbbbbbbbbbbb-0002';

let server: Server;
let url: string;
const captured: string[] = [];
const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;

before(async () => {
  for (const m of ['log', 'error', 'warn'] as const) {
    (console as any)[m] = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); };
  }
  server = createNexusServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  console.log = origLog; console.error = origErr; console.warn = origWarn;
  await new Promise((resolve) => server.close(resolve));
});

function fakeReq(token: string | null): IncomingMessage {
  return { headers: token ? { authorization: `Bearer ${token}` } : {}, socket: { remoteAddress: '10.1.2.3' }, url: '/x' } as unknown as IncomingMessage;
}

test('G4 clientKey for a keyed request is a derived id: stable, distinct per key, never contains the token', () => {
  const a1 = authenticate(fakeReq(KEY1)).clientKey;
  const a2 = authenticate(fakeReq(KEY1)).clientKey;
  const b = authenticate(fakeReq(KEY2)).clientKey;
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.match(a1, /^key:[0-9a-f]{16}$/);
  for (const k of [KEY1, KEY2]) {
    assert.ok(!a1.includes(k) && !b.includes(k));
    assert.ok(!a1.includes(k.slice(0, 12)) && !b.includes(k.slice(0, 12)));
  }
});

test('G4 sync compatibility: ownerKey for a keyed request equals sha256(raw key) — the value /api/sync always stored under — and the sync route round-trips under it', async () => {
  assert.equal(authenticate(fakeReq(KEY1)).ownerKey, createHash('sha256').update(KEY1).digest('hex'));
  const put = await fetch(`${url}/api/sync`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY1}` },
    body: JSON.stringify({ baseVersion: 0, deviceId: 'd1', saltB64: 'cw==', ivB64: 'aXY=', ciphertextB64: 'Y3Q=' }),
  });
  assert.equal(put.status, 200);
  // the record is stored under the historical owner key
  const stored = getRepos().sync.get(createHash('sha256').update(KEY1).digest('hex'));
  assert.ok(stored, 'record must be addressable by sha256(raw key)');
  const get1 = await fetch(`${url}/api/sync`, { headers: { Authorization: `Bearer ${KEY1}` } });
  assert.equal(get1.status, 200);
  const get2 = await fetch(`${url}/api/sync`, { headers: { Authorization: `Bearer ${KEY2}` } });
  assert.equal(get2.status, 404, 'a different key must not see it');
});

test('G4 trusted (no-key) behaviour is unchanged: loopback/LAN identity is the client IP — checked on the pure function with keys cleared', async () => {
  const { ServerConfig } = await import('../src/config/env.js');
  const saved = [...ServerConfig.gatewayKeys];
  ServerConfig.gatewayKeys.length = 0;
  try {
    assert.equal(authenticate(fakeReq(null)).clientKey, '10.1.2.3');
  } finally {
    ServerConfig.gatewayKeys.push(...saved);
  }
});

test('G5 valid, invalid, missing and rate-limited requests + an approval decision leave the raw key NOWHERE (logs, audit rows, decided_by)', async () => {
  // approval with NO explicit decidedBy => the route's default identity is used
  getRepos().approvals.create('leak-task-1', 'test reason');

  const bad = 'WRONG-token-zzzzzzzzzzzz-9999';
  await fetch(`${url}/v2/models`, { headers: { Authorization: `Bearer ${bad}` } });
  await fetch(`${url}/v2/models`);
  const ok = await fetch(`${url}/v2/approvals/leak-task-1/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY1}` },
    body: JSON.stringify({ decision: 'rejected' }),
  });
  assert.equal(ok.status, 200);
  let saw429 = false;
  for (let i = 0; i < 15 && !saw429; i++) {
    const r = await fetch(`${url}/v2/models`, { headers: { Authorization: `Bearer ${KEY2}` } });
    saw429 = r.status === 429;
  }
  assert.ok(saw429, 'a real rate-limit audit event must have been produced');

  const everything = [
    captured.join('\n'),
    JSON.stringify(getRepos().audit.listSecurity(500)),
    JSON.stringify(getRepos().approvals.get('leak-task-1')),
  ].join('\n');

  // rate-limit audit & decided_by were produced, so the scan is meaningful
  assert.match(everything, /Rate limit exceeded/);
  assert.match(everything, /"decidedBy":"key:[0-9a-f]{16}"/);
  for (const secret of [KEY1, KEY2, bad]) {
    assert.ok(!everything.includes(secret), `full secret leaked: ${secret.slice(0, 6)}…`);
    assert.ok(!everything.includes(secret.slice(0, 12)), `12-char prefix leaked: ${secret.slice(0, 6)}…`);
  }
});
