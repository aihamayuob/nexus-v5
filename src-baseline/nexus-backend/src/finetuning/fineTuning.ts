import { getRepos } from '../persistence/repos.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { AgentRegistry } from '../agents/agentRegistry.js';
import { checkGenomeSecurityRisk } from '../evolution/agentGenome.js';
import { Errors } from '../core/errors.js';
import { logger } from '../core/logger.js';
import { auditSecurityEvent } from '../security/audit.js';
import type { FineTuningJobRecord, FineTuningStatus } from '../persistence/repositories/fineTuningJobRepo.js';

/**
 * Controlled Fine-Tuning. The most consequential form of self-modification
 * this platform can perform — more so than Digital Genome's system-prompt
 * mutation (evolution/agentGenome.ts), since a successful job actually
 * trains and produces a persistent, reusable external model artifact. The
 * SAME hard rule applies, enforced even more strictly: versioned (every
 * dataset is one immutable, audited row) + evaluated (quality-gated at
 * the source, not after the fact — see buildDataset()) + security-checked
 * (every training example scanned, not just the aggregate) + approved
 * (explicit human required, no exceptions) + rollbackable (a fine-tuned
 * model is never auto-activated anywhere in this codebase at all — this
 * slice deliberately stops at "a trained model now exists"; wiring a
 * provider to actually USE it is a distinct, separate future decision,
 * so there is nothing here to "roll back" in the live-behavior sense
 * Digital Genome has — the dataset row itself is the permanent, inspectable
 * record either way).
 *
 * Honest scope disclosure: this module targets OpenAI's fine-tuning API
 * specifically — the only mainstream provider in this backend's
 * ProviderRegistry with a standard, well-documented, self-serve
 * fine-tuning API (Anthropic/Gemini do not offer the same self-serve
 * model in this codebase's provider set; Ollama/LM Studio are local
 * inference servers, not training services). submitJob()/pollJob() are
 * real, correct client code for OpenAI's actual /v1/files and
 * /v1/fine_tuning/jobs endpoints — but actually running a real job
 * requires a real OpenAI API key with fine-tuning access and real
 * billing, which this environment does not have. That part is BLOCKED
 * for genuine end-to-end verification here, disclosed plainly rather
 * than faked — see the delivery report.
 */

const MIN_DATASET_EXAMPLES = 3;

interface TrainingExample {
  topic: string;
  proposalContent: string;
}

/**
 * Real, quality-gated dataset construction — zero synthetic/invented
 * examples. Sources ONLY completed cross_exam sessions where this agent
 * was the proposer (so the training text is genuinely their own written
 * output, not mixed with a supervisor's synthesis voice) AND independent
 * verification found no issues (verificationVerdict === 'ok') — an
 * unverified or issue-flagged output must never become fine-tuning
 * material. situation_room is deliberately excluded: there is no single
 * "proposer" role there to attribute training text to.
 */
function collectTrainingExamples(agentId: string): TrainingExample[] {
  const repos = getRepos();
  const sessions = repos.council.listVerifiedProposalsByAgent(agentId);
  const examples: TrainingExample[] = [];
  for (const session of sessions) {
    const rounds = repos.council.rounds(session.id);
    const proposal = rounds.find((r) => r.kind === 'proposal' && r.agentId === agentId);
    if (proposal && proposal.content.trim()) {
      examples.push({ topic: session.topic, proposalContent: proposal.content });
    }
  }
  return examples;
}

function toOpenAiJsonl(systemPrompt: string, examples: TrainingExample[]): string {
  return examples
    .map((ex) =>
      JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: ex.topic },
          { role: 'assistant', content: ex.proposalContent },
        ],
      })
    )
    .join('\n');
}

/**
 * Builds and persists a new dataset proposal for an agent. Real security
 * scanning is applied to EVERY individual training example (not just an
 * aggregate check) via evolution/agentGenome.ts's checkGenomeSecurityRisk
 * — reused directly rather than reimplemented, since the risk is
 * identical in kind (content that could bias/compromise future model
 * behavior) even though the consequence here is more permanent. A single
 * flagged example fails the WHOLE dataset (auto-rejected on the spot,
 * same as a failed Digital Genome proposal) — there is no "drop the bad
 * examples and keep the rest" partial-pass path, since silently editing
 * what a human asked to review is worse than refusing outright.
 */
export function buildDataset(agentId: string, baseModel = 'gpt-4o-mini-2024-07-18'): FineTuningJobRecord {
  const def = AgentRegistry.get(agentId); // throws clearly for an unknown agent id
  const examples = collectTrainingExamples(agentId);
  if (examples.length < MIN_DATASET_EXAMPLES) {
    throw Errors.validation(`أدلة غير كافية لبناء مجموعة بيانات — يوجد ${examples.length} مثالاً موثَّقاً وموثوقاً فقط (الحد الأدنى ${MIN_DATASET_EXAMPLES}). يلزم مزيد من جلسات cross_exam المكتملة والمُتحقَّق منها لهذا الوكيل كمُقترِح.`);
  }

  const allFindings: string[] = [];
  for (let i = 0; i < examples.length; i++) {
    const check = checkGenomeSecurityRisk(examples[i]!.proposalContent);
    if (!check.passed) allFindings.push(...check.findings.map((f) => `مثال #${i + 1}: ${f}`));
  }
  const securityCheckPassed = allFindings.length === 0;

  const jsonl = toOpenAiJsonl(def.systemPrompt, examples);
  const record = getRepos().fineTuningJobs.create({
    agentId,
    datasetExampleCount: examples.length,
    datasetSourceSummary: `${examples.length} مثالاً من جلسات cross_exam مكتملة ومُتحقَّق منها (verification_verdict='ok') كان فيها هذا الوكيل المُقترِح.`,
    datasetJsonl: jsonl,
    securityCheckPassed,
    securityCheckFindings: allFindings,
    provider: 'openai',
    baseModel,
    status: securityCheckPassed ? 'proposed' : 'rejected',
  });

  if (!securityCheckPassed) {
    logger.warn('Fine-tuning dataset auto-rejected by security check', { agentId, findingsCount: allFindings.length });
    auditSecurityEvent('warn', 'Controlled Fine-Tuning: dataset auto-rejected by security check', { agentId, jobId: record.id, findingsCount: allFindings.length });
  }
  return record;
}

export function approveDataset(jobId: string, approvedBy: string): FineTuningJobRecord {
  if (!approvedBy || !approvedBy.trim()) throw Errors.validation('approvedBy مطلوب — لا يمكن اعتماد مجموعة بيانات تدريب بلا هوية بشرية حقيقية.');
  const repos = getRepos();
  const record = repos.fineTuningJobs.get(jobId);
  if (!record) throw Errors.notFound('مهمة التدريب غير موجودة.');
  if (record.status !== 'proposed') throw Errors.validation(`لا يمكن اعتماد مهمة في حالة ${record.status} — يجب أن تكون 'proposed'.`);
  if (!record.securityCheckPassed) throw Errors.validation('لا يمكن اعتماد مجموعة بيانات فشلت الفحص الأمني — هذا حد صارم غير قابل للتجاوز حتى بموافقة بشرية.');
  const decided = repos.fineTuningJobs.decide(jobId, 'approved', approvedBy);
  auditSecurityEvent('warn', 'Controlled Fine-Tuning: dataset approved for submission', { jobId, agentId: record.agentId, exampleCount: record.datasetExampleCount, approvedBy });
  return decided;
}

export function rejectDataset(jobId: string, decidedBy: string): FineTuningJobRecord {
  if (!decidedBy || !decidedBy.trim()) throw Errors.validation('decidedBy مطلوب.');
  const repos = getRepos();
  const record = repos.fineTuningJobs.get(jobId);
  if (!record) throw Errors.notFound('مهمة التدريب غير موجودة.');
  if (record.status !== 'proposed') throw Errors.validation(`لا يمكن رفض مهمة في حالة ${record.status} — يجب أن تكون 'proposed'.`);
  return repos.fineTuningJobs.decide(jobId, 'rejected', decidedBy);
}

/**
 * Real OpenAI API client code (POST /v1/files then POST /v1/fine_tuning/jobs)
 * — not a placeholder. Uses ProviderRegistry.resolve('openai') for the
 * API key/base URL, the SAME configuration every other OpenAI call in
 * this codebase uses; no new credential concept introduced. Requires
 * status === 'approved' — the only path into 'submitted' anywhere in
 * this file.
 */
export async function submitJob(jobId: string): Promise<FineTuningJobRecord> {
  const repos = getRepos();
  const record = repos.fineTuningJobs.get(jobId);
  if (!record) throw Errors.notFound('مهمة التدريب غير موجودة.');
  if (record.status !== 'approved') throw Errors.validation(`لا يمكن إرسال مهمة في حالة ${record.status} — يجب أن تكون 'approved'.`);

  const openai = ProviderRegistry.resolve('openai');
  if (!openai.apiKey) throw Errors.internal('تعذّر إرسال مهمة تدريب حقيقية — مزود OpenAI غير مهيأ (لا مفتاح API).');

  const form = new FormData();
  form.append('purpose', 'fine-tune');
  form.append('file', new Blob([record.datasetJsonl], { type: 'application/jsonl' }), `${record.agentId}-${jobId}.jsonl`);

  const fileRes = await fetch(`${openai.baseUrl}/files`, { method: 'POST', headers: { Authorization: `Bearer ${openai.apiKey}` }, body: form });
  if (!fileRes.ok) {
    const text = await fileRes.text().catch(() => '');
    throw Errors.internal(`فشل رفع ملف التدريب إلى OpenAI (HTTP ${fileRes.status}).`, { providerResponse: text.slice(0, 500) });
  }
  const fileJson = (await fileRes.json()) as { id: string };

  const jobRes = await fetch(`${openai.baseUrl}/fine_tuning/jobs`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ training_file: fileJson.id, model: record.baseModel }),
  });
  if (!jobRes.ok) {
    const text = await jobRes.text().catch(() => '');
    throw Errors.internal(`فشل إنشاء مهمة التدريب على OpenAI (HTTP ${jobRes.status}).`, { providerResponse: text.slice(0, 500) });
  }
  const jobJson = (await jobRes.json()) as { id: string };

  const submitted = repos.fineTuningJobs.markSubmitted(jobId, jobJson.id);
  auditSecurityEvent('warn', 'Controlled Fine-Tuning: job submitted to a real external provider', { jobId, agentId: record.agentId, providerJobId: jobJson.id });
  return submitted;
}

const OPENAI_TERMINAL_STATUS_MAP: Record<string, FineTuningStatus> = { succeeded: 'succeeded', failed: 'failed', cancelled: 'failed' };

/** Polls OpenAI's real job-status endpoint and reflects it locally. Safe to call repeatedly — a no-op status update if nothing changed. */
export async function pollJob(jobId: string): Promise<FineTuningJobRecord> {
  const repos = getRepos();
  const record = repos.fineTuningJobs.get(jobId);
  if (!record) throw Errors.notFound('مهمة التدريب غير موجودة.');
  if (!record.providerJobId) throw Errors.validation('لم تُرسَل هذه المهمة لأي مزود بعد.');

  const openai = ProviderRegistry.resolve('openai');
  if (!openai.apiKey) throw Errors.internal('تعذّر الاستعلام عن حالة حقيقية — مزود OpenAI غير مهيأ.');

  const res = await fetch(`${openai.baseUrl}/fine_tuning/jobs/${record.providerJobId}`, { headers: { Authorization: `Bearer ${openai.apiKey}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Errors.internal(`فشل الاستعلام عن حالة المهمة من OpenAI (HTTP ${res.status}).`, { providerResponse: text.slice(0, 500) });
  }
  const json = (await res.json()) as { status: string; fine_tuned_model: string | null };
  const terminal = OPENAI_TERMINAL_STATUS_MAP[json.status] ?? null;
  return repos.fineTuningJobs.updatePollResult(jobId, json.status, terminal, json.fine_tuned_model ?? null);
}

export function listJobs(agentId?: string): FineTuningJobRecord[] {
  return getRepos().fineTuningJobs.list(agentId);
}
