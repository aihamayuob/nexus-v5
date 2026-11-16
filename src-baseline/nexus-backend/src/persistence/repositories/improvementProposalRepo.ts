import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type ProposalSubjectType = 'mission' | 'council' | 'failure_pattern';
export type ProposalCategory = 'planning' | 'agent_selection' | 'model_selection' | 'verification' | 'reliability' | 'other';
export type ProposalStatus = 'open' | 'acknowledged' | 'dismissed';

export interface ImprovementProposal {
  id: string;
  subjectType: ProposalSubjectType;
  subjectId: string;
  category: ProposalCategory;
  observation: string;
  suggestedChange: string;
  status: ProposalStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

function rowToProposal(row: Record<string, unknown>): ImprovementProposal {
  return {
    id: row.id as string,
    subjectType: row.subject_type as ProposalSubjectType,
    subjectId: row.subject_id as string,
    category: row.category as ProposalCategory,
    observation: row.observation as string,
    suggestedChange: row.suggested_change as string,
    status: row.status as ProposalStatus,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
  };
}

export class ImprovementProposalRepo {
  constructor(private db: DatabaseSync) {}

  create(p: { subjectType: ProposalSubjectType; subjectId: string; category: ProposalCategory; observation: string; suggestedChange: string }): ImprovementProposal {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO improvement_proposals (id, subject_type, subject_id, category, observation, suggested_change, status, created_at, decided_at, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL)`
      )
      .run(id, p.subjectType, p.subjectId, p.category, p.observation, p.suggestedChange, createdAt);
    return this.get(id)!;
  }

  get(id: string): ImprovementProposal | null {
    const row = this.db.prepare('SELECT * FROM improvement_proposals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToProposal(row) : null;
  }

  list(filter: { status?: ProposalStatus; subjectType?: ProposalSubjectType } = {}, limit = 100): ImprovementProposal[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter.subjectType) {
      clauses.push('subject_type = ?');
      params.push(filter.subjectType);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const rows = this.db.prepare(`SELECT * FROM improvement_proposals ${where} ORDER BY created_at DESC LIMIT ?`).all(...(params as [])) as Record<
      string,
      unknown
    >[];
    return rows.map(rowToProposal);
  }

  /** Real dedup guard for MetaCognition's failure-pattern detection — prevents re-flagging the exact same still-unresolved subject every time detection runs (e.g. on a schedule), without needing any caller-side bookkeeping. */
  hasOpenProposalFor(subjectType: ProposalSubjectType, subjectId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS x FROM improvement_proposals WHERE subject_type = ? AND subject_id = ? AND status = 'open' LIMIT 1")
      .get(subjectType, subjectId);
    return !!row;
  }

  /** Human decision only — this NEVER triggers any automatic production change; it just records that a person looked at the proposal. See metaCognition.ts's file doc comment for why this repo has no "apply" method at all. */
  decide(id: string, status: 'acknowledged' | 'dismissed', decidedBy: string): ImprovementProposal | null {
    this.db.prepare('UPDATE improvement_proposals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').run(status, Date.now(), decidedBy, id);
    return this.get(id);
  }
}
