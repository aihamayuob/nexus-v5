import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerConfig } from '../config/env.js';
import { logger } from '../core/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let dbInstance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const path = ServerConfig.dbPath;
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (dir && dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  dbInstance = new DatabaseSync(path);
  dbInstance.exec('PRAGMA journal_mode = WAL;');
  // Production Hardening: without this, SQLite's default is to fail a
  // write IMMEDIATELY with SQLITE_BUSY on writer-vs-writer contention
  // (still possible under WAL between concurrent writers, even though WAL
  // itself lets readers proceed uncontended) instead of waiting a bounded
  // amount of time for the other writer to finish — a real risk on a
  // multi-route HTTP server where background resume tasks
  // (resumeInterruptedMissions/resumeInterruptedCouncilSessions) can be
  // writing at the same moment an incoming request also writes. 5s is
  // comfortably above any single write this codebase performs, while
  // still bounded (a genuinely stuck writer still surfaces as a real
  // error, not an infinite hang).
  dbInstance.exec('PRAGMA busy_timeout = 5000;');
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  runMigrations(dbInstance);
  return dbInstance;
}

/** Only for tests — forces a fresh in-memory DB instead of the shared singleton. */
export function openTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const migrationsDir = join(__dirname, 'migrations');
  const files = existsSync(migrationsDir)
    ? readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    : [];
  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r: unknown) => (r as { name: string }).name)
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, Date.now());
      db.exec('COMMIT');
      logger.info('Migration applied', { file });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
