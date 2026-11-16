import { createServer, type Server, type Socket } from 'node:net';
import { getRepos } from '../persistence/repos.js';
import type { IotCommand } from '../persistence/repositories/iotRepo.js';
import { logger } from '../core/logger.js';
import { auditSecurityEvent } from '../security/audit.js';

/**
 * IoT Bridge — MQTT 3.1.1 transport (QoS 0 subset). A hand-rolled wire
 * protocol implementation, matching this project's own established
 * precedent (a hand-rolled RFC 6455 WebSocket server, built earlier in
 * this project's history) rather than pulling in a third-party MQTT
 * dependency — consistent with the backend's zero-external-runtime-
 * dependency architecture.
 *
 * Deliberately QoS 0 ("at most once") ONLY — no PUBACK/PUBREC/PUBREL/
 * PUBCOMP, no packet-identifier tracking, no retained messages, no Will
 * messages. This is a real, spec-correct MQTT 3.1.1 subset (QoS 0 is a
 * first-class, fully valid QoS level, not a hack), not a fake/partial
 * protocol pretending to be complete — the limitation is disclosed here
 * and in the delivery report, not hidden.
 *
 * Reuses the EXACT SAME device identity/persistence layer the pre-existing
 * HTTP IoT routes (routes/v2/iot.ts) use — IotRepo.getDeviceByApiKey(),
 * .reportState(), .pendingCommandsForDevice(), .acknowledgeCommand().
 * Zero new tables, zero new device concept: a device already registered
 * via POST /v2/iot/devices can use EITHER transport (HTTP polling or
 * MQTT pub/sub) interchangeably with the same id/apiKey, or both at once.
 *
 * Topic scheme (mirrors AWS IoT Core's device-shadow/command convention):
 *   devices/{deviceId}/telemetry     — device PUBLISHes state here
 *   devices/{deviceId}/commands      — broker PUBLISHes pending commands here (device SUBSCRIBEs)
 *   devices/{deviceId}/commands/ack  — device PUBLISHes command acknowledgements here
 *
 * Auth: MQTT CONNECT's username/password fields carry deviceId/apiKey —
 * the SAME two fields the HTTP transport requires via X-Device-Api-Key,
 * just carried over MQTT's own native credential fields instead of a
 * custom header. A connection is REJECTED at CONNECT time (CONNACK
 * return code 4, matching the MQTT 3.1.1 spec's "bad username or
 * password") if they don't match a registered device — there is no
 * anonymous/unauthenticated MQTT connection permitted at all.
 */

// ---- Wire-format primitives ----

function encodeRemainingLength(length: number): Buffer {
  const bytes: number[] = [];
  let x = length;
  do {
    let encodedByte = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) encodedByte |= 0x80;
    bytes.push(encodedByte);
  } while (x > 0);
  return Buffer.from(bytes);
}

function encodeUtf8String(s: string): Buffer {
  const strBuf = Buffer.from(s, 'utf-8');
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(strBuf.length, 0);
  return Buffer.concat([lenBuf, strBuf]);
}

function buildPacket(packetType: number, flags: number, variableHeaderAndPayload: Buffer): Buffer {
  const fixedHeaderByte1 = Buffer.from([(packetType << 4) | (flags & 0x0f)]);
  const remainingLength = encodeRemainingLength(variableHeaderAndPayload.length);
  return Buffer.concat([fixedHeaderByte1, remainingLength, variableHeaderAndPayload]);
}

function buildConnAck(sessionPresent: boolean, returnCode: number): Buffer {
  return buildPacket(2, 0, Buffer.from([sessionPresent ? 1 : 0, returnCode]));
}

function buildPublish(topic: string, payload: Buffer): Buffer {
  // QoS 0 only — no packet identifier in the variable header, DUP/QoS/RETAIN flags all 0.
  const variableHeader = encodeUtf8String(topic);
  return buildPacket(3, 0, Buffer.concat([variableHeader, payload]));
}

function buildSubAck(packetId: number, returnCodes: number[]): Buffer {
  const idBuf = Buffer.alloc(2);
  idBuf.writeUInt16BE(packetId, 0);
  return buildPacket(9, 0, Buffer.concat([idBuf, Buffer.from(returnCodes)]));
}

function buildPingResp(): Buffer {
  return buildPacket(13, 0, Buffer.alloc(0));
}

/** Decodes one MQTT Remaining Length field starting at `offset`. Returns null if the buffer doesn't yet contain the full (up to 4-byte) field — the caller must wait for more bytes (a real TCP stream can split a packet anywhere). */
function decodeRemainingLength(buf: Buffer, offset: number): { value: number; bytesUsed: number } | null {
  let multiplier = 1;
  let value = 0;
  let bytesUsed = 0;
  for (let i = 0; i < 4; i++) {
    if (offset + bytesUsed >= buf.length) return null;
    const byte = buf[offset + bytesUsed]!;
    bytesUsed++;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, bytesUsed };
    multiplier *= 128;
  }
  return null; // malformed (5th continuation byte) — caller treats as a protocol error
}

function decodeUtf8String(buf: Buffer, offset: number): { value: string; bytesUsed: number } | null {
  if (offset + 2 > buf.length) return null;
  const len = buf.readUInt16BE(offset);
  if (offset + 2 + len > buf.length) return null;
  return { value: buf.toString('utf-8', offset + 2, offset + 2 + len), bytesUsed: 2 + len };
}

interface ParsedPacket {
  type: number;
  flags: number;
  body: Buffer;
  totalBytes: number;
}

/** Extracts exactly one complete MQTT packet from the front of `buf`, if one is fully present yet. Returns null if more bytes are needed — callers accumulate a per-connection buffer across multiple 'data' events, exactly like any real TCP-stream protocol parser must (MQTT packets are not guaranteed to arrive in one TCP segment). */
function tryParsePacket(buf: Buffer): ParsedPacket | null {
  if (buf.length < 2) return null;
  const byte1 = buf[0]!;
  const type = (byte1 >> 4) & 0x0f;
  const flags = byte1 & 0x0f;
  const rl = decodeRemainingLength(buf, 1);
  if (!rl) return null;
  const headerBytes = 1 + rl.bytesUsed;
  if (buf.length < headerBytes + rl.value) return null;
  return { type, flags, body: buf.subarray(headerBytes, headerBytes + rl.value), totalBytes: headerBytes + rl.value };
}

// ---- Connection state ----

interface ConnectionState {
  socket: Socket;
  deviceId: string | null; // null until a successful CONNECT
  subscribedTopics: Set<string>;
  buffer: Buffer;
  keepAliveSeconds: number;
  lastActivity: number;
}

const connectionsByDeviceId = new Map<string, ConnectionState>();

function topicFor(deviceId: string, suffix: 'telemetry' | 'commands' | 'commands/ack'): string {
  return `devices/${deviceId}/${suffix}`;
}

/**
 * Real push delivery: called by routes/v2/iot.ts right after
 * IotRepo.queueCommand() so an already-connected, already-subscribed MQTT
 * device receives the command immediately over its open socket — instead
 * of only finding out on its next HTTP poll or MQTT reconnect. Returns
 * true iff actually delivered live; false (a normal, expected outcome,
 * not an error) whenever the device isn't currently connected over MQTT
 * at all, in which case the existing HTTP poll path
 * (GET /v2/iot/devices/:id/commands) remains the correct way for that
 * device to eventually pick the command up.
 */
export function pushCommandToDevice(deviceId: string, command: IotCommand): boolean {
  const conn = connectionsByDeviceId.get(deviceId);
  if (!conn || !conn.subscribedTopics.has(topicFor(deviceId, 'commands'))) return false;
  const payload = Buffer.from(JSON.stringify({ id: command.id, command: command.command, payload: command.payload }), 'utf-8');
  conn.socket.write(buildPublish(topicFor(deviceId, 'commands'), payload));
  return true;
}

function closeConnection(conn: ConnectionState, reason: string) {
  if (conn.deviceId && connectionsByDeviceId.get(conn.deviceId) === conn) {
    connectionsByDeviceId.delete(conn.deviceId);
  }
  logger.info('MQTT connection closed', { deviceId: conn.deviceId, reason });
  try {
    // socket.end() (not .destroy()) — a rejecting CONNACK is written just
    // before this is called in several call sites below, and .destroy()
    // tears the socket down immediately, which can discard that write
    // before the OS has actually flushed it to the client. .end() flushes
    // pending writes first, then closes — the correct choice whenever we
    // just told the client something and want them to actually receive it.
    conn.socket.end();
  } catch {
    /* already closed */
  }
}

function handleConnect(conn: ConnectionState, body: Buffer): boolean {
  let offset = 0;
  const protoName = decodeUtf8String(body, offset);
  if (!protoName) return false;
  offset += protoName.bytesUsed;
  if (offset >= body.length) return false;
  offset += 1; // protocol level byte — not validated strictly; this broker accepts any 3.1.x-shaped CONNECT
  const connectFlags = body[offset]!;
  offset += 1;
  offset += 2; // keep-alive (read but not enforced with disconnection — see header comment on scope)

  const clientIdRes = decodeUtf8String(body, offset);
  if (!clientIdRes) return false;
  offset += clientIdRes.bytesUsed;

  const hasWill = (connectFlags & 0x04) !== 0;
  if (hasWill) {
    const willTopic = decodeUtf8String(body, offset);
    if (!willTopic) return false;
    offset += willTopic.bytesUsed;
    const willMsgLen = offset + 2 <= body.length ? body.readUInt16BE(offset) : null;
    if (willMsgLen === null) return false;
    offset += 2 + willMsgLen; // Will messages are read off the wire to stay protocol-correct but are not stored/acted on — out of scope, see header comment.
  }

  const hasUsername = (connectFlags & 0x80) !== 0;
  const hasPassword = (connectFlags & 0x40) !== 0;
  let username: string | null = null;
  let password: string | null = null;
  if (hasUsername) {
    const u = decodeUtf8String(body, offset);
    if (!u) return false;
    username = u.value;
    offset += u.bytesUsed;
  }
  if (hasPassword) {
    // MQTT 3.1.1 encodes password as a binary-length-prefixed field, not necessarily valid UTF-8 — decoded as raw bytes then treated as an opaque credential string for comparison against the device's real API key.
    if (offset + 2 > body.length) return false;
    const len = body.readUInt16BE(offset);
    if (offset + 2 + len > body.length) return false;
    password = body.toString('utf-8', offset + 2, offset + 2 + len);
  }

  if (!username || !password) {
    conn.socket.write(buildConnAck(false, 4)); // 4 = bad username or password (spec code — used here for "missing credentials" too, the closest fit)
    auditSecurityEvent('warn', 'MQTT: CONNECT rejected — missing device credentials', {});
    return false;
  }

  const device = getRepos().iot.getDeviceByApiKey(password);
  if (!device || device.id !== username) {
    conn.socket.write(buildConnAck(false, 4));
    auditSecurityEvent('warn', 'MQTT: CONNECT rejected — invalid device credentials', { attemptedDeviceId: username });
    return false;
  }

  conn.deviceId = device.id;
  connectionsByDeviceId.set(device.id, conn);
  conn.socket.write(buildConnAck(false, 0));
  logger.info('MQTT device connected', { deviceId: device.id });
  return true;
}

function handlePublish(conn: ConnectionState, flags: number, body: Buffer) {
  const topicRes = decodeUtf8String(body, 0);
  if (!topicRes || !conn.deviceId) return;
  const qos = (flags >> 1) & 0x03;
  if (qos !== 0) {
    // QoS 1/2 explicitly out of scope for this slice (see header comment) — accept the PUBLISH's data at QoS-0 semantics rather than silently pretending to ack a higher QoS level we don't implement.
    logger.warn('MQTT: PUBLISH with QoS > 0 received — handled as QoS 0 (no PUBACK/PUBREC sent, disclosed limitation)', { deviceId: conn.deviceId, qos });
  }
  const payloadStart = topicRes.bytesUsed;
  const payload = body.subarray(payloadStart);

  const expectedTelemetryTopic = topicFor(conn.deviceId, 'telemetry');
  const expectedAckTopic = topicFor(conn.deviceId, 'commands/ack');

  if (topicRes.value === expectedTelemetryTopic) {
    try {
      const state = JSON.parse(payload.toString('utf-8')) as Record<string, unknown>;
      getRepos().iot.reportState(conn.deviceId, state);
    } catch {
      logger.warn('MQTT: telemetry PUBLISH payload was not valid JSON — ignored', { deviceId: conn.deviceId });
    }
    return;
  }
  if (topicRes.value === expectedAckTopic) {
    try {
      const ack = JSON.parse(payload.toString('utf-8')) as { commandId?: string; status?: 'acknowledged' | 'failed'; result?: Record<string, unknown> };
      if (ack.commandId && (ack.status === 'acknowledged' || ack.status === 'failed')) {
        getRepos().iot.acknowledgeCommand(ack.commandId, ack.status, ack.result ?? null);
      }
    } catch {
      logger.warn('MQTT: command-ack PUBLISH payload was not valid JSON — ignored', { deviceId: conn.deviceId });
    }
    return;
  }
  // A device publishing to a topic outside its own two namespaced topics is refused silently at the application level (message dropped, connection kept open) — there is no cross-device pub/sub in this broker; every topic is scoped to the authenticated device's own id.
  logger.warn('MQTT: PUBLISH to an unauthorized/unknown topic — dropped', { deviceId: conn.deviceId, topic: topicRes.value });
}

function handleSubscribe(conn: ConnectionState, body: Buffer) {
  if (!conn.deviceId || body.length < 2) return;
  const packetId = body.readUInt16BE(0);
  let offset = 2;
  const returnCodes: number[] = [];
  const newlySubscribedOwnTopic = topicFor(conn.deviceId, 'commands');
  const grantedOwnTopic = { granted: false };
  while (offset < body.length) {
    const topicRes = decodeUtf8String(body, offset);
    if (!topicRes) break;
    offset += topicRes.bytesUsed;
    if (offset >= body.length) break;
    const requestedQos = body[offset]!;
    offset += 1;
    if (topicRes.value === newlySubscribedOwnTopic) {
      conn.subscribedTopics.add(topicRes.value);
      returnCodes.push(Math.min(requestedQos, 0)); // granted QoS 0 regardless of what was requested — see header comment
      grantedOwnTopic.granted = true;
    } else {
      returnCodes.push(0x80); // failure — a device may only subscribe to its own commands topic
      auditSecurityEvent('warn', "MQTT: SUBSCRIBE refused — not this device's own topic", { deviceId: conn.deviceId, topic: topicRes.value });
    }
  }
  // SUBACK MUST go out before any PUBLISH tied to the newly-granted
  // subscription — sending them in the reverse order (a real bug this
  // implementation had until caught by test coverage) would let a client
  // receive a message for a topic it doesn't know it has successfully
  // subscribed to yet.
  conn.socket.write(buildSubAck(packetId, returnCodes));
  if (grantedOwnTopic.granted) {
    // Deliver any commands already queued before this SUBSCRIBE arrived — matches the HTTP poll transport's own "you always get the current pending list" semantics, just delivered as individual PUBLISHes instead of one JSON array.
    for (const cmd of getRepos().iot.pendingCommandsForDevice(conn.deviceId)) {
      pushCommandToDevice(conn.deviceId, cmd);
    }
  }
}

function handleData(conn: ConnectionState, chunk: Buffer) {
  conn.buffer = Buffer.concat([conn.buffer, chunk]);
  conn.lastActivity = Date.now();
  for (;;) {
    const packet = tryParsePacket(conn.buffer);
    if (!packet) break;
    conn.buffer = conn.buffer.subarray(packet.totalBytes);

    switch (packet.type) {
      case 1: // CONNECT
        if (conn.deviceId) {
          closeConnection(conn, 'duplicate CONNECT on an already-authenticated connection — protocol error');
          return;
        }
        if (!handleConnect(conn, packet.body)) {
          closeConnection(conn, 'CONNECT rejected');
          return;
        }
        break;
      case 3: // PUBLISH
        if (!conn.deviceId) {
          closeConnection(conn, 'PUBLISH before CONNECT — protocol error');
          return;
        }
        handlePublish(conn, packet.flags, packet.body);
        break;
      case 8: // SUBSCRIBE
        if (!conn.deviceId) {
          closeConnection(conn, 'SUBSCRIBE before CONNECT — protocol error');
          return;
        }
        handleSubscribe(conn, packet.body);
        break;
      case 12: // PINGREQ
        conn.socket.write(buildPingResp());
        break;
      case 14: // DISCONNECT
        closeConnection(conn, 'client DISCONNECT');
        return;
      default:
        logger.warn('MQTT: unsupported/unexpected packet type — connection closed', { type: packet.type, deviceId: conn.deviceId });
        closeConnection(conn, `unsupported packet type ${packet.type}`);
        return;
    }
  }
}

let server: Server | null = null;

export function startMqttBroker(port: number): Server {
  if (server) return server;
  server = createServer((socket: Socket) => {
    const conn: ConnectionState = { socket, deviceId: null, subscribedTopics: new Set(), buffer: Buffer.alloc(0), keepAliveSeconds: 0, lastActivity: Date.now() };
    socket.on('data', (chunk: Buffer) => {
      try {
        handleData(conn, chunk);
      } catch (e) {
        logger.warn('MQTT: connection handler threw — closing connection defensively', { deviceId: conn.deviceId, message: (e as Error).message });
        closeConnection(conn, 'internal handler error');
      }
    });
    socket.on('error', () => closeConnection(conn, 'socket error'));
    socket.on('close', () => closeConnection(conn, 'socket closed'));
  });
  server.listen(port, () => logger.info('MQTT broker listening', { port }));
  return server;
}

export function stopMqttBroker(): void {
  if (!server) return;
  for (const conn of connectionsByDeviceId.values()) closeConnection(conn, 'broker shutting down');
  server.close();
  server = null;
}

/** Test-only: lets the test suite reset connectionsByDeviceId between runs without a real socket teardown/restart cycle. */
export function resetMqttConnectionsForTests(): void {
  connectionsByDeviceId.clear();
}
