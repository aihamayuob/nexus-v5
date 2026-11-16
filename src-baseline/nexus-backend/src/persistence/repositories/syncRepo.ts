import type { DatabaseSync } from 'node:sqlite';

export interface SyncRecord {
  version: number;
  deviceId: string;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  updatedAt: number;
}

function rowToRecord(row: Record<string, unknown>): SyncRecord {
  return {
    version: row.version as number,
    deviceId: row.device_id as string,
    saltB64: row.salt_b64 as string,
    ivB64: row.iv_b64 as string,
    ciphertextB64: row.ciphertext_b64 as string,
    updatedAt: row.updated_at as number,
  };
}

export class SyncRepo {
  constructor(private db: DatabaseSync) {}

  get(ownerKey: string): SyncRecord | null {
    const row = this.db.prepare('SELECT * FROM sync_records WHERE owner_key = ?').get(ownerKey) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Optimistic-concurrency write: succeeds only if baseVersion matches the current stored version (or none exists yet). Returns the new record, or null on version conflict (caller should then read current() and surface a 409). */
  put(
    ownerKey: string,
    baseVersion: number,
    deviceId: string,
    saltB64: string,
    ivB64: string,
    ciphertextB64: string
  ): SyncRecord | 'conflict' {
    const existing = this.get(ownerKey);
    if (existing && existing.version !== baseVersion) return 'conflict';
    const version = (existing?.version ?? 0) + 1;
    const updatedAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO sync_records (owner_key, version, device_id, salt_b64, iv_b64, ciphertext_b64, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_key) DO UPDATE SET
           version=excluded.version, device_id=excluded.device_id, salt_b64=excluded.salt_b64,
           iv_b64=excluded.iv_b64, ciphertext_b64=excluded.ciphertext_b64, updated_at=excluded.updated_at`
      )
      .run(ownerKey, version, deviceId, saltB64, ivB64, ciphertextB64, updatedAt);
    return { version, deviceId, saltB64, ivB64, ciphertextB64, updatedAt };
  }

  remove(ownerKey: string) {
    this.db.prepare('DELETE FROM sync_records WHERE owner_key = ?').run(ownerKey);
  }
}
