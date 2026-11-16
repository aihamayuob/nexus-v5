import { randomUUID, createHash } from 'node:crypto';
import { runChatCompletion } from '../orchestrator/chatService.js';
import { TaskObservability } from '../observability/recorder.js';
import { fetchAndExtract } from '../tools/builtin/webFetchTool.js';
import { getRepos } from '../persistence/repos.js';
import { ProviderRegistry } from '../config/providerRegistry.js';
import { ServerConfig } from '../config/env.js';
import { EvaluationEngine, type EvaluationResult, type EvidenceItem } from '../evaluation/evaluationEngine.js';
import { logger } from '../core/logger.js';
import { Errors } from '../core/errors.js';
import type { GatewayContext } from '../capability/permissionModel.js';

/**
 * Web Research (Phase 3 §Web Intelligence). Reuses existing, already-
 * verified infrastructure end to end — adds ZERO new provider-calling
 * code, ZERO new fetch/SSRF logic:
 *   - Grounding: runChatCompletion() with webSearch:true, which
 *     routeModel() already restricts to Gemini (the only provider with
 *     capabilities.webSearch — see modelRouter.ts) — built and tested in
 *     Phase 1, this module is its first real orchestration-level caller.
 *   - Fetching each cited source's full content: fetchAndExtract() from
 *     tools/builtin/webFetchTool.ts, the SAME SSRF-protected fetch the
 *     web_fetch tool uses.
 *
 * Web content is UNTRUSTED DATA throughout, per the master directive's
 * own rule: a fetched source's content is stored as inert reference text
 * on a memory item, NEVER re-injected as an instruction, NEVER used to
 * modify system prompts/permissions/secrets/production state. Citation
 * URLs come from Gemini's grounding metadata, which is itself untrusted
 * (see contract.ts's GroundingMetadata doc comment) — surfaced to the
 * caller as citations to verify, never asserted as fact by NEXUS itself.
 *
 * Explicitly OUT OF SCOPE for this slice (disclosed, not hidden): a
 * second independent search-provider adapter (e.g. Brave) for real
 * cross-provider conflict detection, sub-query decomposition for complex
 * multi-part questions, and a freshness/TTL policy engine — see
 * PHASE3_SLICE12_REPORT.md's "Recommended Next Slice".
 *
 * Phase 3 Slice 16: the answer this module produces is now, by default,
 * itself run through the new Unified Evaluation Engine
 * (evaluation/evaluationEngine.ts) against the successfully-fetched
 * sources as evidence — giving an honest VERIFIED/SUPPORTED/UNCERTAIN/
 * CONFLICTING/UNVERIFIED label instead of presenting every research
 * answer with the same unqualified confidence regardless of how well (or
 * poorly) it was actually corroborated. This is real orchestration-level
 * reuse of a general-purpose primitive, not evaluation logic invented
 * specifically for this module.
 */

export interface ResearchSource {
  url: string;
  domain: string;
  retrievedAt: number;
  /** Bounded excerpt actually fetched via fetchAndExtract() — real content, not the citation title alone. Empty when the follow-up fetch failed (fetchOk:false) — the citation itself is still real, just its full text wasn't retrievable (e.g. blocked, 404, timeout). */
  contentPreview: string;
  contentHash: string;
  fetchOk: boolean;
}

export interface WebResearchResult {
  question: string;
  answer: string;
  webSearchQueries: string[];
  sources: ResearchSource[];
  memoryItemId: string | null;
  /** false when Gemini isn't configured — degrades gracefully (mirrors verifier.ts's "unavailable" pattern) rather than throwing, since research is a capability, not a hard requirement. */
  ran: boolean;
  /** Phase 3 Slice 16 — null only when ran:false (no answer was even produced to evaluate) or when opts.evaluate === false. Otherwise always populated, including the UNVERIFIED case where zero sources were successfully fetched — see evaluationEngine.ts's zero-evidence fast path. */
  evaluation: EvaluationResult | null;
}

const MAX_SOURCES_TO_FETCH = 5;
const CONTENT_PREVIEW_CHARS = 2000;

function domainOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * Evidence Integrity (ADR-004): the producer contract of web research, as a pure function so it can be tested (the SSRF guard makes a
 * fetchOk:true source unreachable in the sandboxed tests). Only successfully fetched sources are evidence at all, and each one is a real
 * tool result (the output of fetchAndExtract) — declared as such. The Gemini answer being evaluated is never itself declared evidence.
 */
export function buildResearchEvidence(sources: ResearchSource[]): EvidenceItem[] {
  return sources.filter((s) => s.fetchOk).map((s) => ({ source: s.url, content: s.contentPreview, kind: 'TOOL_RESULT' }));
}

export async function runWebResearch(
  question: string,
  gwCtx: GatewayContext,
  opts: { persistToMemory?: boolean; projectId?: string | null; evaluate?: boolean } = {}
): Promise<WebResearchResult> {
  if (!question || !question.trim()) throw Errors.validation('السؤال مطلوب.');

  if (!ProviderRegistry.resolve('gemini').apiKey) {
    return { question, answer: '', webSearchQueries: [], sources: [], memoryItemId: null, ran: false, evaluation: null };
  }

  const obs = new TaskObservability(`web_research_${randomUUID().slice(0, 8)}`, 'runtime_plan');
  const result = await runChatCompletion(
    {
      mode: 'BEST',
      system:
        'أنت باحث ويب دقيق. أجب على سؤال المستخدم بالاعتماد حصراً على نتائج بحث حقيقية حديثة. كن موجزاً ودقيقاً، واذكر النقاط الأساسية فقط دون حشو.',
      messages: [{ role: 'user', content: question }],
      maxTokens: 1200,
      webSearch: true,
      route: 'web_research',
      signal: AbortSignal.timeout(ServerConfig.defaultTaskTimeoutMs), // dedicated resilience testing fix — same class of gap as the judge-call helpers (see env.ts's judgeCallTimeoutMs comment), confirmed empirically to hang forever otherwise against an unresponsive endpoint. Uses the longer task timeout (not judgeCallTimeoutMs) since this is a full grounded-search completion, not a quick classification call.
    },
    gwCtx,
    obs
  );

  const textBlock = result.content.find((b) => b.type === 'text');
  const answer = textBlock && textBlock.type === 'text' ? textBlock.text : '';
  const citations = result.grounding?.citations ?? [];
  const webSearchQueries = result.grounding?.webSearchQueries ?? [];

  const toFetch = citations.slice(0, MAX_SOURCES_TO_FETCH);
  const fetched = await Promise.allSettled(toFetch.map((c) => fetchAndExtract(c.uri)));

  const sources: ResearchSource[] = toFetch.map((citation, i) => {
    const r = fetched[i]!;
    const retrievedAt = Date.now();
    if (r.status === 'fulfilled') {
      const preview = r.value.text.slice(0, CONTENT_PREVIEW_CHARS);
      return {
        url: citation.uri,
        domain: domainOf(citation.uri),
        retrievedAt,
        contentPreview: preview,
        contentHash: createHash('sha256').update(preview).digest('hex'),
        fetchOk: true,
      };
    }
    logger.warn('Web research: follow-up fetch for a cited source failed (non-fatal — citation itself still recorded)', {
      url: citation.uri,
      message: (r.reason as Error)?.message,
    });
    return { url: citation.uri, domain: domainOf(citation.uri), retrievedAt, contentPreview: '', contentHash: '', fetchOk: false };
  });

  let memoryItemId: string | null = null;
  if (opts.persistToMemory !== false) {
    const provenanceBlock = sources.map((s) => `- [${s.domain}] ${s.url}${s.fetchOk ? '' : ' (تعذّر جلب المحتوى الكامل)'}`).join('\n');
    const content =
      `سؤال البحث: ${question}\n\nالإجابة (مبنية على بحث ويب حقيقي، راجع المصادر):\n${answer}` +
      (sources.length ? `\n\nالمصادر:\n${provenanceBlock}` : '');
    const item = getRepos().memory.add({
      projectId: opts.projectId ?? null,
      userId: null,
      kind: 'knowledge',
      title: `بحث ويب: ${question.slice(0, 120)}`,
      content,
      embedding: null,
    });
    memoryItemId = item.id;
  }

  // Phase 3 Slice 16 — evaluate the answer against whatever evidence was
  // actually, successfully fetched (fetchOk sources only: a failed fetch
  // contributed no real content, so it must not be counted as evidence).
  // On by default; opt out via evaluate:false for callers that don't need
  // the extra judge-provider call (e.g. a tight loop of many small
  // research calls where the caller does its own evaluation downstream).
  let evaluation: EvaluationResult | null = null;
  if (opts.evaluate !== false && answer) {
    const evidence = buildResearchEvidence(sources);
    evaluation = await EvaluationEngine.evaluate(answer, evidence);
    getRepos().claimEvaluations.save('web_research', memoryItemId, answer, evidence, evaluation);
  }

  return { question, answer, webSearchQueries, sources, memoryItemId, ran: true, evaluation };
}
