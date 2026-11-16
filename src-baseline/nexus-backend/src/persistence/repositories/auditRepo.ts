import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export interface VetoAuditEvent {
  id: string;
  topic: string;
  reviewerAgentId: string;
  rejectedItems: { item: string; reason: string }[];
  rawReviewText: string;
  createdAt: number;
}

export interface SecurityAuditEvent {
  id: string;
  severity: 'info' | 'warn' | 'critical';
  message: string;
  meta: Record<string, unknown>;
  createdAt: number;
}

export class AuditRepo {
  constructor(private db: DatabaseSync) {}

  logVeto(topic: string, reviewerAgentId: string, rejectedItems: { item: string; reason: string }[], rawReviewText: string): VetoAuditEvent {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO audit_log (id, kind, topic, reviewer_agent_id, rejected_items_json, raw_review_text, created_at)
         VALUES (?, 'veto', ?, ?, ?, ?, ?)`
      )
      .run(id, topic, reviewerAgentId, JSON.stringify(rejectedItems), rawReviewText, createdAt);
    return { id, topic, reviewerAgentId, rejectedItems, rawReviewText, createdAt };
  }

  listVeto(limit: number, before?: number): VetoAuditEvent[] {
    const rows = before
      ? (this.db
          .prepare("SELECT * FROM audit_log WHERE kind='veto' AND created_at < ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
          .all(before, limit) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM audit_log WHERE kind='veto' ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Record<
          string,
          unknown
        >[]);
    return rows.map((r) => ({
      id: r.id as string,
      topic: r.topic as string,
      reviewerAgentId: r.reviewer_agent_id as string,
      rejectedItems: JSON.parse((r.rejected_items_json as string) || '[]'),
      rawReviewText: r.raw_review_text as string,
      createdAt: r.created_at as number,
    }));
  }

  logSecurity(severity: SecurityAuditEvent['severity'], message: string, meta: Record<string, unknown> = {}): void {
    this.db
      .prepare(`INSERT INTO audit_log (id, kind, severity, message, meta_json, created_at) VALUES (?, 'security', ?, ?, ?, ?)`)
      .run(randomUUID(), severity, message, JSON.stringify(meta), Date.now());
  }

  listSecurity(limit = 100): SecurityAuditEvent[] {
    const rows = this.db
      .prepare("SELECT * FROM audit_log WHERE kind='security' ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      severity: r.severity as SecurityAuditEvent['severity'],
      message: r.message as string,
      meta: JSON.parse((r.meta_json as string) || '{}'),
      createdAt: r.created_at as number,
    }));
  }

  /** Audit trail is retained much longer than operational logs by design (its whole purpose is looking back), but "unbounded forever" is still a real disk-growth risk over years — this exists so a deployment CAN bound it if it chooses to, not because every deployment should call it on a short timer. */
  pruneOlderThan(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    const result = this.db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(cutoff);
    return Number(result.changes ?? 0);
  }
}
