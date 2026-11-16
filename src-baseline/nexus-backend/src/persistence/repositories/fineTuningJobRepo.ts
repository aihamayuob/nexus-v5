import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type FineTuningStatus = 'proposed' | 'rejected' | 'approved' | 'submitted' | 'succeeded' | 'failed';

export interface FineTuningJobRecord {
  id: string;
  agentId: string;
  datasetExampleCount: number;
  datasetSourceSummary: string;
  datasetJsonl: string;
  securityCheckPassed: boolean;
  securityCheckFindings: string[];
  provider: string;
  baseModel: string;
  status: FineTuningStatus;
  providerJobId: string | null;
  providerFineTunedModel: string | null;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  submittedAt: number | null;
  lastPolledAt: number | null;
  lastProviderStatus: string | null;
}

function rowToRecord(row: Record<string, unknown>): FineTuningJobRecord {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    datasetExampleCount: row.dataset_example_count as number,
    datasetSourceSummary: row.dataset_source_summary as string,
    datasetJsonl: row.dataset_jsonl as string,
    securityCheckPassed: (row.security_check_passed as number) === 1,
    securityCheckFindings: JSON.parse(row.security_check_findings_json as string) as string[],
    provider: row.provider as string,
    baseModel: row.base_model as string,
    status: row.status as FineTuningStatus,
    providerJobId: (row.provider_job_id as string) ?? null,
    providerFineTunedModel: (row.provider_fine_tuned_model as string) ?? null,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
    submittedAt: (row.submitted_at as number) ?? null,
    lastPolledAt: (row.last_polled_at as number) ?? null,
    lastProviderStatus: (row.last_provider_status as string) ?? null,
  };
}

export class FineTuningJobRepo {
  constructor(private db: DatabaseSync) {}

  create(j: {
    agentId: string;
    datasetExampleCount: number;
    datasetSourceSummary: string;
    datasetJsonl: string;
    securityCheckPassed: boolean;
    securityCheckFindings: string[];
    provider: string;
    baseModel: string;
    status: FineTuningStatus;
  }): FineTuningJobRecord {
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO finetuning_jobs (id, agent_id, dataset_example_count, dataset_source_summary, dataset_jsonl, security_check_passed, security_check_findings_json, provider, base_model, status, provider_job_id, provider_fine_tuned_model, created_at, decided_at, decided_by, submitted_at, last_polled_at, last_provider_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, NULL)`
      )
      .run(
        id,
        j.agentId,
        j.datasetExampleCount,
        j.datasetSourceSummary,
        j.datasetJsonl,
        j.securityCheckPassed ? 1 : 0,
        JSON.stringify(j.securityCheckFindings),
        j.provider,
        j.baseModel,
        j.status,
        createdAt,
        j.status === 'rejected' ? createdAt : null,
        j.status === 'rejected' ? 'system:security_check' : null
      );
    return this.get(id)!;
  }

  get(id: string): FineTuningJobRecord | null {
    const row = this.db.prepare('SELECT * FROM finetuning_jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(agentId?: string): FineTuningJobRecord[] {
    const rows = agentId
      ? (this.db.prepare('SELECT * FROM finetuning_jobs WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM finetuning_jobs ORDER BY created_at DESC').all() as Record<string, unknown>[]);
    return rows.map(rowToRecord);
  }

  decide(id: string, status: 'approved' | 'rejected', decidedBy: string): FineTuningJobRecord {
    this.db.prepare('UPDATE finetuning_jobs SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?').run(status, Date.now(), decidedBy, id);
    return this.get(id)!;
  }

  markSubmitted(id: string, providerJobId: string): FineTuningJobRecord {
    this.db.prepare("UPDATE finetuning_jobs SET status = 'submitted', provider_job_id = ?, submitted_at = ? WHERE id = ?").run(providerJobId, Date.now(), id);
    return this.get(id)!;
  }

  updatePollResult(id: string, providerStatus: string, terminalStatus: FineTuningStatus | null, fineTunedModel: string | null): FineTuningJobRecord {
    this.db
      .prepare('UPDATE finetuning_jobs SET last_polled_at = ?, last_provider_status = ?, status = COALESCE(?, status), provider_fine_tuned_model = COALESCE(?, provider_fine_tuned_model) WHERE id = ?')
      .run(Date.now(), providerStatus, terminalStatus, fineTunedModel, id);
    return this.get(id)!;
  }
}
