import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type GenomeStatus = 'proposed' | 'rejected' | 'active' | 'superseded';
export type GenomeEvaluationVerdict = 'candidate_better' | 'baseline_better' | 'no_clear_difference' | 'unavailable';

export interface AgentGenomeRecord {
  id: string;
  agentId: string;
  version: number;
  parentVersion: number | null;
  systemPrompt: string;
  rationale: string;
  securityCheckPassed: boolean;
  securityCheckFindings: string[];
  evaluationVerdict: GenomeEvaluationVerdict | null;
  evaluationRationale: string | null;
  status: GenomeStatus;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

function rowToRecord(row: Record<string, unknown>): AgentGenomeRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    version: row.version as number,
    parentVersion: (row.parent_version as number) ?? null,
    systemPrompt: row.system_prompt as string,
    rationale: row.rationale as string,
    securityCheckPassed: (row.security_check_passed as number) === 1,
    securityCheckFindings: JSON.parse(row.security_check_findings_json as string) as string[],
    evaluationVerdict: (row.evaluation_verdict as GenomeEvaluationVerdict) ?? null,
    evaluationRationale: (row.evaluation_rationale as string) ?? null,
    status: row.status as GenomeStatus,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
  };
}

export class AgentGenomeRepo {
  constructor(private db: DatabaseSync) {}

  /** Next version number for an agent — 1 for its first-ever proposal, otherwise max(existing)+1. Versions are never reused, even across rejected proposals, so a version number always uniquely identifies one real historical proposal. */
  private nextVersion(agentId: string): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM agent_genomes WHERE agent_id = ?').get(agentId) as { v: number | null };
    return (row.v ?? 0) + 1;
  }

  create(g: {
    agentId: string;
    parentVersion: number | null;
    systemPrompt: string;
    rationale: string;
    securityCheckPassed: boolean;
    securityCheckFindings: string[];
    evaluationVerdict: GenomeEvaluationVerdict | null;
    evaluationRationale: string | null;
    status: GenomeStatus;
  }): AgentGenomeRecord {
    const id = randomUUID();
    const version = this.nextVersion(g.agentId);
    const createdAt = Date.now();
    const decidedAt = g.status === 'rejected' ? createdAt : null; // an automatic security-fail rejection is itself a real decision, timestamped honestly — not left looking like it's still awaiting human review
    this.db
      .prepare(
        `INSERT INTO agent_genomes (id, agent_id, version, parent_version, system_prompt, rationale, security_check_passed, security_check_findings_json, evaluation_verdict, evaluation_rationale, status, created_at, decided_at, decided_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        g.agentId,
        version,
        g.parentVersion,
        g.systemPrompt,
        g.rationale,
        g.securityCheckPassed ? 1 : 0,
        JSON.stringify(g.securityCheckFindings),
        g.evaluationVerdict,
        g.evaluationRationale,
        g.status,
        createdAt,
        decidedAt,
        g.status === 'rejected' ? 'system:security_check' : null
      );
    return this.get(id)!;
  }

  get(id: string): AgentGenomeRecord | null {
    const row = this.db.prepare('SELECT * FROM agent_genomes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  getByVersion(agentId: string, version: number): AgentGenomeRecord | null {
    const row = this.db.prepare('SELECT * FROM agent_genomes WHERE agent_id = ? AND version = ?').get(agentId, version) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(agentId: string): AgentGenomeRecord[] {
    const rows = this.db.prepare('SELECT * FROM agent_genomes WHERE agent_id = ? ORDER BY version DESC').all(agentId) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  /** The one row currently governing an agent's real runtime behavior — agentRunner.ts's ONLY read from this repo. Null means "no override, use AgentRegistry's static built-in systemPrompt". */
  active(agentId: string): AgentGenomeRecord | null {
    const row = this.db.prepare("SELECT * FROM agent_genomes WHERE agent_id = ? AND status = 'active' LIMIT 1").get(agentId) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  /** Atomic (single transaction) activation: whatever was 'active' for this agent becomes 'superseded', and the target row becomes 'active'. Used identically by both approveGenomeVersion() (activating a fresh proposal) and rollbackAgentGenome() (re-activating an older superseded row) in evolution/agentGenome.ts — one real state-machine transition, not two similar-but-different code paths. */
  activate(agentId: string, id: string, decidedBy: string): AgentGenomeRecord {
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      this.db.prepare("UPDATE agent_genomes SET status = 'superseded' WHERE agent_id = ? AND status = 'active'").run(agentId);
      this.db.prepare("UPDATE agent_genomes SET status = 'active', decided_at = ?, decided_by = ? WHERE id = ?").run(now, decidedBy, id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return this.get(id)!;
  }

  reject(id: string, decidedBy: string): AgentGenomeRecord {
    this.db.prepare("UPDATE agent_genomes SET status = 'rejected', decided_at = ?, decided_by = ? WHERE id = ?").run(Date.now(), decidedBy, id);
    return this.get(id)!;
  }
}
