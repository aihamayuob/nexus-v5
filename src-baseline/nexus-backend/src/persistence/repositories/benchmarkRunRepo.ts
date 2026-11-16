import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface BenchmarkRunRecord {
  id: string;
  releaseLabel: string;
  results: unknown;
  summary: unknown;
  createdAt: number;
}

export class BenchmarkRunRepo {
  constructor(private db: DatabaseSync) {}

  save(releaseLabel: string, results: unknown, summary: unknown): BenchmarkRunRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare('INSERT INTO benchmark_runs (id, release_label, results_json, summary_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, releaseLabel, JSON.stringify(results), JSON.stringify(summary), createdAt);
    return { id, releaseLabel, results, summary, createdAt };
  }

  latest(): BenchmarkRunRecord | null {
    // ORDER BY created_at alone is not a reliable tiebreaker when two runs
    // are saved within the same millisecond (very realistic in tests/CI
    // running the suite back-to-back) — rowid (SQLite's implicit
    // insertion-order column) breaks ties deterministically.
    const row = this.db.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC, rowid DESC LIMIT 1').get() as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRecord(row) : null;
  }

  /** The run immediately before the latest one — "previous release" for comparison. */
  previous(): BenchmarkRunRecord | null {
    const rows = this.db.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC, rowid DESC LIMIT 2').all() as Record<
      string,
      unknown
    >[];
    return rows.length >= 2 ? this.rowToRecord(rows[1]!) : null;
  }

  list(limit = 20): BenchmarkRunRecord[] {
    const rows = this.db.prepare('SELECT * FROM benchmark_runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToRecord(r));
  }

  private rowToRecord(row: Record<string, unknown>): BenchmarkRunRecord {
    return {
      id: row.id as string,
      releaseLabel: row.release_label as string,
      results: JSON.parse(row.results_json as string),
      summary: JSON.parse(row.summary_json as string),
      createdAt: row.created_at as number,
    };
  }
}
