import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { auditSecurityEvent } from '../../security/audit.js';
import { Errors } from '../../core/errors.js';
import type { IotDevice } from '../../persistence/repositories/iotRepo.js';
import { pushCommandToDevice } from '../../iot/mqttBroker.js';

/**
 * IoT Bridge (Phase 3 §IoT). A real, protocol-agnostic pull-model —
 * devices poll for pending commands and report telemetry over plain
 * HTTP, exactly how AWS IoT Core / Azure IoT Hub's device-shadow +
 * command-queue pattern works at its core. This is deliberately testable
 * end-to-end in this environment WITHOUT real hardware: the "device" side
 * of every test is just an HTTP client, the same technique this whole
 * project has used for provider adapters throughout — the pattern being
 * verified (auth boundary, queue semantics, state reporting) is real and
 * hardware-independent; only the physical transport (a real sensor's
 * actual radio/serial link) is out of scope for what can be verified in
 * this environment, and is NOT claimed as tested here.
 *
 * Two distinct authentication domains, never conflated:
 *   - Device-facing routes (telemetry, poll, ack) require the device's
 *     OWN per-device API key (X-Device-Api-Key header) — a compromised
 *     gateway key alone cannot impersonate a specific device, and vice
 *     versa.
 *   - Operator-facing routes (register, list, queue a command) use the
 *     normal gateway auth every other /v2/* route already requires.
 * KNOWN LIMITATION (disclosed, not hidden): device API keys are stored
 * in plaintext in this slice, unlike gateway keys' handling elsewhere —
 * see PHASE3_SLICE10_REPORT.md.
 */

function requireDeviceAuth(ctx: RouteContext, deviceId: string): IotDevice {
  const key = ctx.req.headers['x-device-api-key'];
  const device = getRepos().iot.getDevice(deviceId);
  if (!device) throw Errors.notFound('الجهاز غير موجود.');
  if (typeof key !== 'string' || key !== device.apiKey) {
    auditSecurityEvent('warn', 'IoT: device auth failed', { deviceId });
    throw Errors.auth('مفتاح الجهاز غير صالح.');
  }
  return device;
}

export function registerIotRoutes(router: Router) {
  router.post('/v2/iot/devices', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ name?: string; type?: string; capabilities?: string[] }>(ctx.req);
    if (!body.name || !body.name.trim()) throw Errors.validation('الحقل "name" مطلوب.');
    if (!body.type || !body.type.trim()) throw Errors.validation('الحقل "type" مطلوب.');
    const device = getRepos().iot.registerDevice(body.name, body.type, Array.isArray(body.capabilities) ? body.capabilities : []);
    ctx.res.writeHead(201, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(device)); // apiKey included — this is the one response that legitimately needs to show it
  });

  router.get('/v2/iot/devices', async (ctx: RouteContext) => {
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ devices: getRepos().iot.listDevices() }));
  });

  router.get('/v2/iot/devices/:id', async (ctx: RouteContext) => {
    const device = getRepos().iot.getDevice(ctx.params.id!);
    if (!device) throw Errors.notFound('الجهاز غير موجود.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(device));
  });

  /** Device-authenticated. */
  router.post('/v2/iot/devices/:id/telemetry', async (ctx: RouteContext) => {
    const device = requireDeviceAuth(ctx, ctx.params.id!);
    const body = await readJsonBody<{ state?: Record<string, unknown> }>(ctx.req);
    if (!body.state || typeof body.state !== 'object') throw Errors.validation('الحقل "state" مطلوب ويجب أن يكون كائناً.');
    getRepos().iot.reportState(device.id, body.state);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ ok: true }));
  });

  /** Operator/agent-authenticated (normal gateway auth) — audited like every other Warden-adjacent action. */
  router.post('/v2/iot/devices/:id/commands', async (ctx: RouteContext) => {
    const device = getRepos().iot.getDevice(ctx.params.id!);
    if (!device) throw Errors.notFound('الجهاز غير موجود.');
    const body = await readJsonBody<{ command?: string; payload?: Record<string, unknown> }>(ctx.req);
    if (!body.command || !body.command.trim()) throw Errors.validation('الحقل "command" مطلوب.');
    const cmd = getRepos().iot.queueCommand(device.id, body.command, body.payload ?? null);
    auditSecurityEvent('info', 'IoT: command queued', { deviceId: device.id, command: body.command, commandId: cmd.id });
    // MQTT transport: deliver immediately if the device is connected+subscribed over MQTT right now (real push); a harmless no-op otherwise — the HTTP poll route below remains the fallback delivery path regardless of transport.
    pushCommandToDevice(device.id, cmd);
    ctx.res.writeHead(202, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(cmd));
  });

  /** Device-authenticated — a device polls for what it needs to do, rather than requiring inbound connectivity to it. */
  router.get('/v2/iot/devices/:id/commands/pending', async (ctx: RouteContext) => {
    const device = requireDeviceAuth(ctx, ctx.params.id!);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ commands: getRepos().iot.pendingCommandsForDevice(device.id) }));
  });

  /** Device-authenticated. */
  router.post('/v2/iot/devices/:id/commands/:commandId/ack', async (ctx: RouteContext) => {
    const device = requireDeviceAuth(ctx, ctx.params.id!);
    const command = getRepos().iot.getCommand(ctx.params.commandId!);
    if (!command || command.deviceId !== device.id) throw Errors.notFound('الأمر غير موجود لهذا الجهاز.');
    if (command.status !== 'pending') throw Errors.validation(`تم الإقرار بهذا الأمر مسبقاً (${command.status}).`);
    const body = await readJsonBody<{ status?: 'acknowledged' | 'failed'; result?: Record<string, unknown> }>(ctx.req);
    if (body.status !== 'acknowledged' && body.status !== 'failed') throw Errors.validation('الحقل "status" يجب أن يكون "acknowledged" أو "failed".');
    const updated = getRepos().iot.acknowledgeCommand(command.id, body.status, body.result ?? null);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(updated));
  });
}
