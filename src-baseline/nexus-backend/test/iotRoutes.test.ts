import '../test/helpers/setTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

let nexusServer: Server;
let nexusUrl: string;

before(async () => {
  nexusServer = createNexusServer();
  await new Promise<void>((resolve) => {
    nexusServer.listen(0, '127.0.0.1', () => {
      const addr = nexusServer.address();
      nexusUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise((r) => nexusServer.close(r));
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

async function registerDevice(name = 'مستشعر حرارة تجريبي', type = 'sensor.temperature', capabilities: string[] = ['read_temp']) {
  const res = await fetch(`${nexusUrl}/v2/iot/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, type, capabilities }),
  });
  assert.equal(res.status, 201);
  return (await res.json()) as { id: string; apiKey: string; name: string };
}

test('POST /v2/iot/devices registers a real device with a real generated, unique API key', async () => {
  const d1 = await registerDevice();
  const d2 = await registerDevice('جهاز آخر', 'sensor.humidity', ['read_humidity']);
  assert.ok(d1.apiKey.length >= 32);
  assert.notEqual(d1.apiKey, d2.apiKey);
  assert.notEqual(d1.id, d2.id);
});

test('POST /v2/iot/devices with missing required fields is a validation error', async () => {
  const res = await fetch(`${nexusUrl}/v2/iot/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ناقص' }),
  });
  assert.equal(res.status, 400);
});

test('GET /v2/iot/devices lists real registered devices', async () => {
  await registerDevice('جهاز 1', 'sensor.a', []);
  await registerDevice('جهاز 2', 'sensor.b', []);
  const res = await fetch(`${nexusUrl}/v2/iot/devices`);
  const body = (await res.json()) as { devices: unknown[] };
  assert.equal(body.devices.length, 2);
});

test('GET /v2/iot/devices/:id for an unknown device is a real 404', async () => {
  const res = await fetch(`${nexusUrl}/v2/iot/devices/does-not-exist`);
  assert.equal(res.status, 404);
});

// ---- device auth boundary ----

test('POST telemetry WITHOUT the device API key is a real 401, not silently accepted', async () => {
  const device = await registerDevice();
  const res = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { tempC: 22 } }),
  });
  assert.equal(res.status, 401);
});

test("POST telemetry with the WRONG device API key (e.g. another device's key) is a real 401", async () => {
  const deviceA = await registerDevice('جهاز أ');
  const deviceB = await registerDevice('جهاز ب');
  const res = await fetch(`${nexusUrl}/v2/iot/devices/${deviceA.id}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Api-Key': deviceB.apiKey },
    body: JSON.stringify({ state: { tempC: 22 } }),
  });
  assert.equal(res.status, 401, "device B's real key must not authenticate as device A");
});

test('POST telemetry with the CORRECT device API key actually updates the real reported state', async () => {
  const device = await registerDevice();
  const res = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Api-Key': device.apiKey },
    body: JSON.stringify({ state: { tempC: 24.5, battery: 88 } }),
  });
  assert.equal(res.status, 200);

  const getRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}`);
  const full = (await getRes.json()) as { reportedState: { tempC: number; battery: number }; lastSeenAt: number | null };
  assert.equal(full.reportedState.tempC, 24.5);
  assert.equal(full.reportedState.battery, 88);
  assert.ok(full.lastSeenAt !== null);
});

// ---- command queue lifecycle ----

test('POST a command is queued as real "pending", audited, and reachable by the device via its own real polling endpoint', async () => {
  const device = await registerDevice();
  const queueRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'set_target_temp', payload: { celsius: 21 } }),
  });
  assert.equal(queueRes.status, 202);
  const cmd = (await queueRes.json()) as { id: string; status: string };
  assert.equal(cmd.status, 'pending');

  const pendingRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/pending`, { headers: { 'X-Device-Api-Key': device.apiKey } });
  assert.equal(pendingRes.status, 200);
  const pendingBody = (await pendingRes.json()) as { commands: Array<{ id: string; command: string; payload: { celsius: number } }> };
  assert.equal(pendingBody.commands.length, 1);
  assert.equal(pendingBody.commands[0]!.command, 'set_target_temp');
  assert.equal(pendingBody.commands[0]!.payload.celsius, 21);
});

test('a device cannot poll pending commands for ANOTHER device using its own key', async () => {
  const deviceA = await registerDevice('جهاز أ');
  const deviceB = await registerDevice('جهاز ب');
  await fetch(`${nexusUrl}/v2/iot/devices/${deviceA.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'reboot' }),
  });
  const res = await fetch(`${nexusUrl}/v2/iot/devices/${deviceA.id}/commands/pending`, { headers: { 'X-Device-Api-Key': deviceB.apiKey } });
  assert.equal(res.status, 401);
});

test('acknowledging a command actually transitions it to "acknowledged" and removes it from the real pending list', async () => {
  const device = await registerDevice();
  const queueRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'reboot' }),
  });
  const cmd = (await queueRes.json()) as { id: string };

  const ackRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/${cmd.id}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Api-Key': device.apiKey },
    body: JSON.stringify({ status: 'acknowledged', result: { uptimeAfterReboot: 3 } }),
  });
  assert.equal(ackRes.status, 200);
  const acked = (await ackRes.json()) as { status: string; result: { uptimeAfterReboot: number } };
  assert.equal(acked.status, 'acknowledged');
  assert.equal(acked.result.uptimeAfterReboot, 3);

  const pendingRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/pending`, { headers: { 'X-Device-Api-Key': device.apiKey } });
  const pendingBody = (await pendingRes.json()) as { commands: unknown[] };
  assert.equal(pendingBody.commands.length, 0, 'an acknowledged command must disappear from the real pending queue');
});

test('a command can be acknowledged as "failed" with a real error result', async () => {
  const device = await registerDevice();
  const queueRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'set_target_temp', payload: { celsius: 999 } }),
  });
  const cmd = (await queueRes.json()) as { id: string };
  const ackRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/${cmd.id}/ack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Api-Key': device.apiKey },
    body: JSON.stringify({ status: 'failed', result: { error: 'قيمة خارج المدى المسموح' } }),
  });
  assert.equal(ackRes.status, 200);
  const acked = (await ackRes.json()) as { status: string };
  assert.equal(acked.status, 'failed');
});

test('acknowledging an already-acknowledged command is rejected, not silently accepted twice', async () => {
  const device = await registerDevice();
  const queueRes = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'reboot' }),
  });
  const cmd = (await queueRes.json()) as { id: string };
  const headers = { 'Content-Type': 'application/json', 'X-Device-Api-Key': device.apiKey };
  await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/${cmd.id}/ack`, { method: 'POST', headers, body: JSON.stringify({ status: 'acknowledged' }) });
  const secondAck = await fetch(`${nexusUrl}/v2/iot/devices/${device.id}/commands/${cmd.id}/ack`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status: 'acknowledged' }),
  });
  assert.equal(secondAck.status, 400);
});

test('POST /v2/iot/devices/:id/commands for an unknown device is a real 404', async () => {
  const res = await fetch(`${nexusUrl}/v2/iot/devices/does-not-exist/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: 'x' }),
  });
  assert.equal(res.status, 404);
});
