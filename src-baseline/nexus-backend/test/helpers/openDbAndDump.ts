// Test helper (CP-16, AC-7): opens the database named by NEXUS_DB_PATH through the REAL getDb()/runMigrations path
// and prints one JSON line describing the claim_evaluations schema, the applied migrations and the legacy row.
// Spawned by test/evidenceIntegrity.test.ts in a child process (getDb() is a process-wide singleton).
import { getDb } from '../../src/persistence/db.js';
import { buildRepos } from '../../src/persistence/repos.js';

const db = getDb();
const cols = db.prepare('PRAGMA table_info(claim_evaluations)').all();
const migs = db.prepare('SELECT name FROM _migrations ORDER BY name').all();
const rec = buildRepos(db).claimEvaluations.get('legacy-1');
const raw = db.prepare("SELECT * FROM claim_evaluations WHERE id = 'legacy-1'").get();
console.log(JSON.stringify({ cols, migs, rec, raw }));
