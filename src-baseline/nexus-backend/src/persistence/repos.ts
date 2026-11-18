import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './db.js';
import { TaskRepo } from './repositories/taskRepo.js';
import { CheckpointRepo } from './repositories/checkpointRepo.js';
import { StreamEventRepo } from './repositories/streamEventRepo.js';
import { ObservabilityRepo } from './repositories/observabilityRepo.js';
import { AuditRepo } from './repositories/auditRepo.js';
import { EmbeddingCacheRepo } from './repositories/embeddingCacheRepo.js';
import { IdempotencyRepo } from './repositories/idempotencyRepo.js';
import { ScheduleRepo } from './repositories/scheduleRepo.js';
import { SyncRepo } from './repositories/syncRepo.js';
import { MemoryRepo } from './repositories/memoryRepo.js';
import { ProviderCallLogRepo } from './repositories/providerCallLogRepo.js';
import { FeedbackRepo } from './repositories/feedbackRepo.js';
import { BenchmarkRunRepo } from './repositories/benchmarkRunRepo.js';
import { ApprovalRepo } from './repositories/approvalRepo.js';
import { MissionRepo } from './repositories/missionRepo.js';
import { AgentFailureRepo } from './repositories/agentFailureRepo.js';
import { CouncilRepo } from './repositories/councilRepo.js';
import { ImprovementProposalRepo } from './repositories/improvementProposalRepo.js';
import { MemoryConsolidationRepo } from './repositories/memoryConsolidationRepo.js';
import { IotRepo } from './repositories/iotRepo.js';
import { AgentCallLogRepo } from './repositories/agentCallLogRepo.js';
import { WardenIsolationRepo } from './repositories/wardenIsolationRepo.js';
import { ClaimEvaluationRepo } from './repositories/claimEvaluationRepo.js';
import { AgentGenomeRepo } from './repositories/agentGenomeRepo.js';
import { KnowledgeFreshnessRepo } from './repositories/knowledgeFreshnessRepo.js';
import { FineTuningJobRepo } from './repositories/fineTuningJobRepo.js';
import { ExecutionReceiptRepo } from './repositories/executionReceiptRepo.js';
import { McpToolPinRepo } from './repositories/mcpToolPinRepo.js';
import { A2aTaskRepo } from './repositories/a2aTaskRepo.js';

export interface Repos {
  tasks: TaskRepo;
  checkpoints: CheckpointRepo;
  streamEvents: StreamEventRepo;
  observability: ObservabilityRepo;
  audit: AuditRepo;
  embeddingCache: EmbeddingCacheRepo;
  idempotency: IdempotencyRepo;
  schedules: ScheduleRepo;
  sync: SyncRepo;
  memory: MemoryRepo;
  providerCallLog: ProviderCallLogRepo;
  feedback: FeedbackRepo;
  benchmarkRuns: BenchmarkRunRepo;
  approvals: ApprovalRepo;
  missions: MissionRepo;
  agentFailures: AgentFailureRepo;
  council: CouncilRepo;
  improvementProposals: ImprovementProposalRepo;
  memoryConsolidation: MemoryConsolidationRepo;
  iot: IotRepo;
  agentCallLog: AgentCallLogRepo;
  wardenIsolation: WardenIsolationRepo;
  claimEvaluations: ClaimEvaluationRepo;
  agentGenomes: AgentGenomeRepo;
  knowledgeFreshness: KnowledgeFreshnessRepo;
  fineTuningJobs: FineTuningJobRepo;
  executionReceipts: ExecutionReceiptRepo;
  mcpToolPins: McpToolPinRepo;
  a2aTasks: A2aTaskRepo;
}

export function buildRepos(db: DatabaseSync): Repos {
  return {
    tasks: new TaskRepo(db),
    checkpoints: new CheckpointRepo(db),
    streamEvents: new StreamEventRepo(db),
    observability: new ObservabilityRepo(db),
    audit: new AuditRepo(db),
    embeddingCache: new EmbeddingCacheRepo(db),
    idempotency: new IdempotencyRepo(db),
    schedules: new ScheduleRepo(db),
    sync: new SyncRepo(db),
    memory: new MemoryRepo(db),
    providerCallLog: new ProviderCallLogRepo(db),
    feedback: new FeedbackRepo(db),
    benchmarkRuns: new BenchmarkRunRepo(db),
    approvals: new ApprovalRepo(db),
    missions: new MissionRepo(db),
    agentFailures: new AgentFailureRepo(db),
    council: new CouncilRepo(db),
    improvementProposals: new ImprovementProposalRepo(db),
    memoryConsolidation: new MemoryConsolidationRepo(db),
    iot: new IotRepo(db),
    agentCallLog: new AgentCallLogRepo(db),
    wardenIsolation: new WardenIsolationRepo(db),
    claimEvaluations: new ClaimEvaluationRepo(db),
    agentGenomes: new AgentGenomeRepo(db),
    knowledgeFreshness: new KnowledgeFreshnessRepo(db),
    fineTuningJobs: new FineTuningJobRepo(db),
    executionReceipts: new ExecutionReceiptRepo(db),
    mcpToolPins: new McpToolPinRepo(db),
    a2aTasks: new A2aTaskRepo(db),
  };
}

let singleton: Repos | null = null;
export function getRepos(): Repos {
  if (!singleton) singleton = buildRepos(getDb());
  return singleton;
}

/** Test-only: reset the singleton so each test file gets its own in-memory DB. */
export function resetReposSingletonForTests(repos: Repos | null) {
  singleton = repos;
}
