CREATE TABLE IF NOT EXISTS iot_devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  api_key TEXT NOT NULL,
  reported_state_json TEXT,
  registered_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_iot_devices_api_key ON iot_devices(api_key);

CREATE TABLE IF NOT EXISTS iot_commands (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES iot_devices(id),
  command TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'acknowledged' | 'failed'
  result_json TEXT,
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_iot_commands_device_status ON iot_commands(device_id, status);
