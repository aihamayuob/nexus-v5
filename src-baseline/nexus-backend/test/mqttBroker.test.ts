import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connect, type Socket } from 'node:net';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests, getRepos } from '../src/persistence/repos.js';
import { startMqttBroker, stopMqttBroker, pushCommandToDevice, resetMqttConnectionsForTests } from '../src/iot/mqttBroker.js';
import type { Server } from 'node:net';

function freshDb() {
  resetReposSingletonForTests(buildRepos(openTestDb()));
}

// ---- Minimal MQTT 3.1.1 CLIENT-side packet encoder/decoder — hand-built for these tests,
// speaking the exact same real wire protocol the broker implements. No MQTT library used
// anywhere (this whole backend has zero runtime dependencies) — this is a real client,
// not a mock, exactly the same "the fake IS a real protocol speaker" methodology used
// throughout this project for provider adapters.

function encodeRemainingLength(length: number): Buffer {
  const bytes: number[] = [];
  let x = length;
  do {
    let b = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) b |= 0x80;
    bytes.push(b);
  } while (x > 0);
  return Buffer.from(bytes);
}

function encStr(s: string): Buffer {
  const b = Buffer.from(s, 'utf-8');
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length, 0);
  return Buffer.concat([len, b]);
}

function packet(type: number, flags: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeRemainingLength(body.length), body]);
}

function connectPacket(clientId: string, username: string, password: string): Buffer {
  const variableHeader = Buffer.concat([encStr('MQTT'), Buffer.from([4]), Buffer.from([0xc2]), Buffer.from([0, 30])]); // username+password flags, keepalive=30
  const payload = Buffer.concat([encStr(clientId), encStr(username), encStr(password)]);
  return packet(1, 0, Buffer.concat([variableHeader, payload]));
}

function publishPacket(topic: string, payload: object | string): Buffer {
  const payloadBuf = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf-8');
  return packet(3, 0, Buffer.concat([encStr(topic), payloadBuf]));
}

function subscribePacket(packetId: number, topic: string): Buffer {
  const idBuf = Buffer.alloc(2);
  idBuf.writeUInt16BE(packetId, 0);
  return packet(8, 2, Buffer.concat([idBuf, encStr(topic), Buffer.from([0])]));
}

function pingReqPacket(): Buffer {
  return packet(12, 0, Buffer.alloc(0));
}

function disconnectPacket(): Buffer {
  return packet(14, 0, Buffer.alloc(0));
}

interface ReceivedPacket {
  type: number;
  body: Buffer;
}

/** Small test harness: connects, tracks all fully-parsed inbound packets, and lets a test await the Nth one. */
class TestMqttClient {
  socket: Socket;
  received: ReceivedPacket[] = [];
  private buffer = Buffer.alloc(0);
  private waiters: Array<() => void> = [];

  constructor(port: number) {
    this.socket = connect(port, '127.0.0.1');
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });
  }

  private drain() {
    for (;;) {
      if (this.buffer.length < 2) return;
      const type = (this.buffer[0]! >> 4) & 0x0f;
      let multiplier = 1;
      let value = 0;
      let bytesUsed = 0;
      let done = false;
      for (let i = 0; i < 4; i++) {
        if (1 + bytesUsed >= this.buffer.length) return;
        const b = this.buffer[1 + bytesUsed]!;
        bytesUsed++;
        value += (b & 0x7f) * multiplier;
        if ((b & 0x80) === 0) {
          done = true;
          break;
        }
        multiplier *= 128;
      }
      if (!done) return;
      const headerLen = 1 + bytesUsed;
      if (this.buffer.length < headerLen + value) return;
      const body = this.buffer.subarray(headerLen, headerLen + value);
      this.buffer = this.buffer.subarray(headerLen + value);
      this.received.push({ type, body: Buffer.from(body) });
      const w = this.waiters.shift();
      if (w) w();
    }
  }

  async waitForCount(n: number, timeoutMs = 3000): Promise<void> {
    const start = Date.now();
    while (this.received.length < n) {
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} packets, got ${this.received.length}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async ready(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('connect', () => resolve());
      this.socket.once('error', reject);
    });
  }

  close() {
    this.socket.destroy();
  }
}

/** Waits for a socket to be closed, tolerating the real race where 'close' has already fired by the time the caller gets around to waiting for it (checks current state first, rather than assuming the event is still pending). */
function waitForClose(socket: Socket, timeoutMs = 3000): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for socket close')), timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

let port: number;
let server: Server;

before(async () => {
  server = startMqttBroker(0); // port 0 = OS-assigned free port, exactly like every HTTP test server in this suite
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

after(async () => {
  stopMqttBroker();
});

beforeEach(() => {
  freshDb();
  resetMqttConnectionsForTests();
});

test('CONNECT with valid device credentials is accepted (CONNACK return code 0)', async () => {
  const device = getRepos().iot.registerDevice('جهاز اختبار', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('test-client', device.id, device.apiKey));
  await client.waitForCount(1);
  assert.equal(client.received[0]!.type, 2); // CONNACK
  assert.equal(client.received[0]!.body[1], 0); // return code 0 = accepted
  client.close();
});

test('CONNECT with a wrong API key is rejected (CONNACK return code 4) and the connection is closed', async () => {
  const device = getRepos().iot.registerDevice('جهاز اختبار', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('test-client', device.id, 'wrong-key-entirely'));
  await client.waitForCount(1);
  assert.equal(client.received[0]!.body[1], 4); // bad username/password
  await waitForClose(client.socket);
});

test('CONNECT with a deviceId/apiKey mismatch (valid key, wrong claimed id) is rejected', async () => {
  const deviceA = getRepos().iot.registerDevice('جهاز أ', 'sensor', []);
  const deviceB = getRepos().iot.registerDevice('جهاز ب', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('test-client', deviceA.id, deviceB.apiKey)); // claims to be A, but presents B's real key
  await client.waitForCount(1);
  assert.equal(client.received[0]!.body[1], 4);
  client.close();
});

test('PUBLISH to the telemetry topic real-updates the device\'s reported state via the SAME IotRepo the HTTP transport uses', async () => {
  const device = getRepos().iot.registerDevice('حساس حرارة', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(publishPacket(`devices/${device.id}/telemetry`, { temperature: 23.5 }));
  await new Promise((r) => setTimeout(r, 150));

  const updated = getRepos().iot.getDevice(device.id)!;
  assert.deepEqual(updated.reportedState, { temperature: 23.5 });
  assert.ok(updated.lastSeenAt);
  client.close();
});

test('SUBSCRIBE to a device\'s own commands topic succeeds (SUBACK) and immediately delivers any already-pending commands', async () => {
  const device = getRepos().iot.registerDevice('محرك', 'actuator', []);
  const queued = getRepos().iot.queueCommand(device.id, 'open', { angle: 45 });

  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(subscribePacket(1, `devices/${device.id}/commands`));
  await client.waitForCount(3); // CONNACK + SUBACK + the pending command's PUBLISH

  const suback = client.received[1]!;
  assert.equal(suback.type, 9);
  assert.equal(suback.body[2], 0); // granted QoS 0

  const pushedCmd = client.received[2]!;
  assert.equal(pushedCmd.type, 3); // PUBLISH
  const topicLen = pushedCmd.body.readUInt16BE(0);
  const topic = pushedCmd.body.toString('utf-8', 2, 2 + topicLen);
  assert.equal(topic, `devices/${device.id}/commands`);
  const payload = JSON.parse(pushedCmd.body.toString('utf-8', 2 + topicLen));
  assert.equal(payload.id, queued.id);
  assert.equal(payload.command, 'open');
  client.close();
});

test('SUBSCRIBE to a topic that is not the device\'s own is refused (SUBACK failure code 0x80)', async () => {
  const deviceA = getRepos().iot.registerDevice('أ', 'sensor', []);
  const deviceB = getRepos().iot.registerDevice('ب', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', deviceA.id, deviceA.apiKey));
  await client.waitForCount(1);
  client.socket.write(subscribePacket(1, `devices/${deviceB.id}/commands`)); // trying to snoop on a different device
  await client.waitForCount(2);
  const suback = client.received[1]!;
  assert.equal(suback.body[2], 0x80);
  client.close();
});

test('pushCommandToDevice() delivers live to an already-subscribed MQTT connection — the real push path routes/v2/iot.ts uses', async () => {
  const device = getRepos().iot.registerDevice('جهاز', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(subscribePacket(1, `devices/${device.id}/commands`));
  await client.waitForCount(2); // CONNACK + SUBACK (no pending commands yet)

  const cmd = getRepos().iot.queueCommand(device.id, 'ping', null);
  const delivered = pushCommandToDevice(device.id, cmd);
  assert.equal(delivered, true);
  await client.waitForCount(3);
  const pushedPacket = client.received[2]!;
  assert.equal(pushedPacket.type, 3);
  client.close();
});

test('pushCommandToDevice() returns false (not an error) when the device has no live MQTT connection', () => {
  const delivered = pushCommandToDevice('no-such-device-connected', { id: 'x', deviceId: 'x', command: 'y', payload: null, status: 'pending', result: null, createdAt: Date.now(), acknowledgedAt: null });
  assert.equal(delivered, false);
});

test('PUBLISH to the commands/ack topic real-acknowledges the command via the SAME IotRepo the HTTP transport uses', async () => {
  const device = getRepos().iot.registerDevice('جهاز', 'actuator', []);
  const cmd = getRepos().iot.queueCommand(device.id, 'close', null);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(publishPacket(`devices/${device.id}/commands/ack`, { commandId: cmd.id, status: 'acknowledged', result: { ok: true } }));
  await new Promise((r) => setTimeout(r, 150));

  const updated = getRepos().iot.getCommand(cmd.id)!;
  assert.equal(updated.status, 'acknowledged');
  assert.deepEqual(updated.result, { ok: true });
  client.close();
});

test('PINGREQ receives a real PINGRESP', async () => {
  const device = getRepos().iot.registerDevice('جهاز', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(pingReqPacket());
  await client.waitForCount(2);
  assert.equal(client.received[1]!.type, 13); // PINGRESP
  client.close();
});

test('DISCONNECT cleanly closes the connection from the server side', async () => {
  const device = getRepos().iot.registerDevice('جهاز', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  client.socket.write(disconnectPacket());
  await waitForClose(client.socket);
});

test('a CONNECT packet split across multiple TCP writes still parses correctly — real stream-buffering correctness', async () => {
  const device = getRepos().iot.registerDevice('جهاز مقسّم', 'sensor', []);
  const full = connectPacket('c1', device.id, device.apiKey);
  const client = new TestMqttClient(port);
  await client.ready();
  const mid = Math.floor(full.length / 2);
  client.socket.write(full.subarray(0, mid));
  await new Promise((r) => setTimeout(r, 80)); // give the broker a chance to (correctly) NOT process a partial packet
  assert.equal(client.received.length, 0, 'a partial packet must never be processed early');
  client.socket.write(full.subarray(mid));
  await client.waitForCount(1);
  assert.equal(client.received[0]!.body[1], 0); // CONNACK accepted, once the full packet finally arrived
  client.close();
});

test('two PUBLISH packets sent back-to-back in a single TCP write are both parsed independently', async () => {
  const device = getRepos().iot.registerDevice('جهاز', 'sensor', []);
  const client = new TestMqttClient(port);
  await client.ready();
  client.socket.write(connectPacket('c1', device.id, device.apiKey));
  await client.waitForCount(1);
  const p1 = publishPacket(`devices/${device.id}/telemetry`, { temperature: 10 });
  const p2 = publishPacket(`devices/${device.id}/telemetry`, { temperature: 20 });
  client.socket.write(Buffer.concat([p1, p2])); // one single TCP write containing two full packets
  await new Promise((r) => setTimeout(r, 150));

  const updated = getRepos().iot.getDevice(device.id)!;
  assert.deepEqual(updated.reportedState, { temperature: 20 }, 'the second PUBLISH must be processed too, not dropped');
  client.close();
});
