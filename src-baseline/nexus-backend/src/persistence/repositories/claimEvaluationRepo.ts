import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { EvaluationResult, EvidenceItem } from '../../evaluation/evaluationEngine.js';

export interface ClaimEvaluationRecord {
  id: string;
  subjectType: string;
  subjectId: string | null;
  claim: string;
  ran: boolean;
  verdict: string;
  confidence: number | null;
  rationale: string;
  supportingEvidenceCount: number;
  conflictingEvidenceCount: number;
  evidence: EvidenceItem[];
  /** Why the verdict is what it is (Evidence Integrity, ADR-004). null for rows from before migration 016 and for ran:false rows. */
  integrityReason: string | null;
  createdAt: number;
}

function rowToRecord(row: Record<string, unknown>): ClaimEvaluationRecord {
  return {
    id: row.id as string,
    subjectType: row.subject_type as string,
    subjectId: (row.subject_id as string) ?? null,
    claim: row.claim as string,
    ran: (row.ran as number) === 1,
    verdict: row.verdict as string,
    confidence: (row.confidence as number) ?? null,
    rationale: row.rationale as string,
    supportingEvidenceCount: row.supporting_evidence_count as number,
    conflictingEvidenceCount: row.conflicting_evidence_count as number,
    evidence: JSON.parse(row.evidence_json as string) as EvidenceItem[],
    integrityReason: (row.integrity_reason as string | null | undefined) ?? null,
    createdAt: row.created_at as number,
  };
}

export class ClaimEvaluationRepo {
  constructor(private db: DatabaseSync) {}

  save(subjectType: string, subjectId: string | null, claim: string, evidence: EvidenceItem[], result: EvaluationResult): ClaimEvaluationRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO claim_evaluations (id, subject_type, subject_id, claim, ran, verdict, confidence, rationale, supporting_evidence_count, conflicting_evidence_count, evidence_json, created_at, integrity_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        subjectType,
        subjectId,
        claim,
        result.ran ? 1 : 0,
        result.verdict,
        result.confidence,
        result.rationale,
        result.supportingEvidenceCount,
        result.conflictingEvidenceCount,
        JSON.stringify(evidence),
        createdAt,
        result.integrityReason ?? null
      );
    return { id, subjectType, subjectId, claim, ran: result.ran, verdict: result.verdict, confidence: result.confidence, rationale: result.rationale, supportingEvidenceCount: result.supportingEvidenceCount, conflictingEvidenceCount: result.conflictingEvidenceCount, evidence, integrityReason: result.integrityReason ?? null, createdAt };
  }

  get(id: string): ClaimEvaluationRecord | null {
    const row = this.db.prepare('SELECT * FROM claim_evaluations WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(limit = 20, subjectType?: string): ClaimEvaluationRecord[] {
    const rows = subjectType
      ? (this.db.prepare('SELECT * FROM claim_evaluations WHERE subject_type = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(subjectType, limit) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM claim_evaluations ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as Record<string, unknown>[]);
    return rows.map(rowToRecord);
  }
}
