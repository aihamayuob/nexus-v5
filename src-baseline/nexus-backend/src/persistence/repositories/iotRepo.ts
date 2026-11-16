import type { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';

export interface IotDevice {
  id: string;
  name: string;
  type: string;
  capabilities: string[];
  apiKey: string;
  reportedState: Record<string, unknown> | null;
  registeredAt: number;
  lastSeenAt: number | null;
}

export type IotCommandStatus = 'pending' | 'acknowledged' | 'failed';

export interface IotCommand {
  id: string;
  deviceId: string;
  command: string;
  payload: Record<string, unknown> | null;
  status: IotCommandStatus;
  result: Record<string, unknown> | null;
  createdAt: number;
  acknowledgedAt: number | null;
}

function rowToDevice(row: Record<string, unknown>): IotDevice {
  return {
    id: row.id as string,
    name: row.name as string,
    type: row.type as string,
    capabilities: JSON.parse(row.capabilities_json as string),
    apiKey: row.api_key as string,
    reportedState: row.reported_state_json ? JSON.parse(row.reported_state_json as string) : null,
    registeredAt: row.registered_at as number,
    lastSeenAt: (row.last_seen_at as number) ?? null,
  };
}

function rowToCommand(row: Record<string, unknown>): IotCommand {
  return {
    id: row.id as string,
    deviceId: row.device_id as string,
    command: row.command as string,
    payload: row.payload_json ? JSON.parse(row.payload_json as string) : null,
    status: row.status as IotCommandStatus,
    result: row.result_json ? JSON.parse(row.result_json as string) : null,
    createdAt: row.created_at as number,
    acknowledgedAt: (row.acknowledged_at as number) ?? null,
  };
}

export class IotRepo {
  constructor(private db: DatabaseSync) {}

  registerDevice(name: string, type: string, capabilities: string[]): IotDevice {
    const id = randomUUID();
    const apiKey = randomBytes(24).toString('hex');
    const registeredAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO iot_devices (id, name, type, capabilities_json, api_key, reported_state_json, registered_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL)`
      )
      .run(id, name, type, JSON.stringify(capabilities), apiKey, registeredAt);
    return this.getDevice(id)!;
  }

  getDevice(id: string): IotDevice | null {
    const row = this.db.prepare('SELECT * FROM iot_devices WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToDevice(row) : null;
  }

  getDeviceByApiKey(apiKey: string): IotDevice | null {
    const row = this.db.prepare('SELECT * FROM iot_devices WHERE api_key = ?').get(apiKey) as Record<string, unknown> | undefined;
    return row ? rowToDevice(row) : null;
  }

  listDevices(): IotDevice[] {
    const rows = this.db.prepare('SELECT * FROM iot_devices ORDER BY registered_at DESC').all() as Record<string, unknown>[];
    return rows.map(rowToDevice);
  }

  reportState(deviceId: string, state: Record<string, unknown>): void {
    const now = Date.now();
    this.db.prepare('UPDATE iot_devices SET reported_state_json = ?, last_seen_at = ? WHERE id = ?').run(JSON.stringify(state), now, deviceId);
  }

  queueCommand(deviceId: string, command: string, payload: Record<string, unknown> | null): IotCommand {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO iot_commands (id, device_id, command, payload_json, status, result_json, created_at, acknowledged_at)
         VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)`
      )
      .run(id, deviceId, command, payload ? JSON.stringify(payload) : null, createdAt);
    return this.getCommand(id)!;
  }

  getCommand(id: string): IotCommand | null {
    const row = this.db.prepare('SELECT * FROM iot_commands WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToCommand(row) : null;
  }

  pendingCommandsForDevice(deviceId: string): IotCommand[] {
    const rows = this.db
      .prepare("SELECT * FROM iot_commands WHERE device_id = ? AND status = 'pending' ORDER BY created_at ASC")
      .all(deviceId) as Record<string, unknown>[];
    return rows.map(rowToCommand);
  }

  acknowledgeCommand(id: string, status: 'acknowledged' | 'failed', result: Record<string, unknown> | null): IotCommand | null {
    this.db
      .prepare('UPDATE iot_commands SET status = ?, result_json = ?, acknowledged_at = ? WHERE id = ?')
      .run(status, result ? JSON.stringify(result) : null, Date.now(), id);
    return this.getCommand(id);
  }
}
