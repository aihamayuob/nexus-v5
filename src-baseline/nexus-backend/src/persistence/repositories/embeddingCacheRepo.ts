import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

export function hashText(text: string): string {
  return createHash('sha256').update(text.normalize('NFC')).digest('hex');
}

export class EmbeddingCacheRepo {
  constructor(private db: DatabaseSync) {}

  get(text: string, provider: string, model: string): number[] | null {
    const row = this.db
      .prepare('SELECT vector_json FROM embeddings_cache WHERE text_hash = ? AND provider = ? AND model = ?')
      .get(hashText(text), provider, model) as Record<string, unknown> | undefined;
    return row ? (JSON.parse(row.vector_json as string) as number[]) : null;
  }

  set(text: string, provider: string, model: string, vector: number[]) {
    this.db
      .prepare(
        `INSERT INTO embeddings_cache (text_hash, provider, model, vector_json, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(text_hash, provider, model) DO NOTHING`
      )
      .run(hashText(text), provider, model, JSON.stringify(vector), Date.now());
  }

  getMany(texts: string[], provider: string, model: string): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const t of texts) {
      const v = this.get(t, provider, model);
      if (v) out.set(t, v);
    }
    return out;
  }
}
