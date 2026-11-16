import { AgentRegistry } from '../agents/agentRegistry.js';
import { runCouncilSession } from '../council/councilRunner.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { Errors } from '../core/errors.js';

const DEFAULT_MAX_AGENTS = 4;
const MIN_AGENTS_REQUIRED = 2;

export interface FormSwarmResult {
  sessionId: string;
  selectedAgentIds: string[];
}

/**
 * Dynamic Swarm: the caller gives only a topic (no participant list) —
 * this picks WHICH specialists actually participate, then hands off to
 * the exact same, already-tested situation_room engine from Slice 4
 * (councilRunner.ts's executeSituationRoom via runCouncilSession()). This
 * file adds ZERO new round/discussion logic; "dynamic" refers strictly
 * to membership selection, via AgentRegistry.selectTopAgentsForTask()'s
 * real keyword-overlap scoring — never an LLM asked to "guess" who's
 * relevant, and never a random/fixed default panel dressed up as
 * "dynamic". If fewer than 2 agents in the registry have any real
 * keyword overlap with the topic, this throws rather than forcing an
 * unrelated pair together — a caller who hits that should either
 * rephrase the topic or fall back to POST /v2/council (situation_room)
 * with an explicit participantAgentIds list.
 */
export async function formSwarm(
  topic: string,
  gwCtx: GatewayContext,
  maxAgents: number = DEFAULT_MAX_AGENTS,
  humanitarianVeto: boolean = false
): Promise<FormSwarmResult> {
  if (maxAgents < MIN_AGENTS_REQUIRED) throw Errors.validation(`maxAgents يجب أن يكون ${MIN_AGENTS_REQUIRED} على الأقل.`);
  const selected = AgentRegistry.selectTopAgentsForTask(topic, maxAgents);
  if (selected.length < MIN_AGENTS_REQUIRED) {
    throw Errors.validation(
      `تعذّر تكوين سرب ديناميكي بثقة: لم يُعثر إلا على ${selected.length} متخصص ذي صلة حقيقية بالموضوع (الحد الأدنى ${MIN_AGENTS_REQUIRED}). أعد صياغة الموضوع بمصطلحات أوضح، أو استخدم POST /v2/council مباشرة مع participantAgentIds محدد يدوياً.`
    );
  }
  const selectedAgentIds = selected.map((d) => d.id);
  const { sessionId } = await runCouncilSession({ mode: 'situation_room', topic, participantAgentIds: selectedAgentIds, humanitarianVeto }, gwCtx);
  return { sessionId, selectedAgentIds };
}
