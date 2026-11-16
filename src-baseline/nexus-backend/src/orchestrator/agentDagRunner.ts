import { AgentRegistry } from '../agents/agentRegistry.js';
import { runAgentTask } from '../agents/agentRunner.js';
import { runChatCompletion } from './chatService.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { TaskObservability } from '../observability/recorder.js';
import type { DagTaskDef } from './dagTypes.js';
import type { NodeRunContext, ReflectionResult } from './dag.js';
import type { DagRunnerDeps } from './dagRunner.js';

const REFLECT_SYSTEM_PROMPT = `أنت مراجع ذاتي صارم لناتج مهمة فرعية واحدة. أجب حصراً بصيغة JSON: {"verdict":"ok"|"revise","critique":"سبب موجز إن كان يحتاج مراجعة"}. لا تطلب مراجعة إلا لسبب حقيقي — التحسين الشكلي البسيط لا يستحق جولة إضافية.`;
const SYNTHESIS_SYSTEM_PROMPT = `اِدمج نتائج المهام الفرعية التالية في إجابة نهائية واحدة متماسكة تلبي الهدف الأصلي الكلي. نظّم الإجابة بعناوين واضحة حسب الحاجة، ولا تكرر عرض كل نتيجة فرعية حرفياً — لخّص ووحّد.`;

/**
 * `missionId`/`taskNodeId` here exist purely so a node's failure history
 * lands under the right agent + mission in agent_failures — this module
 * has no other mission-specific knowledge, keeping it reusable outside a
 * Mission too (e.g. a future standalone multi-agent call).
 */
export function createAgentDagRunner(gwCtx: GatewayContext, obs: TaskObservability, missionId: string): DagRunnerDeps {
  return {
    async runNode(node: DagTaskDef, ctx: NodeRunContext, signal?: AbortSignal): Promise<string> {
      const agentDef = AgentRegistry.selectAgentForTask(node.description);
      obs.recordAgent(`${node.id}:${agentDef.id}`);
      const result = await runAgentTask(agentDef.id, {
        agentId: agentDef.id,
        missionId,
        taskNodeId: node.id,
        taskDescription: `الهدف الكلي: ${ctx.goal}\n\nمهمتك الفرعية المحددة: ${node.description}`,
        upstreamOutputs: ctx.upstreamOutputs,
        gwCtx,
        signal,
      });
      return result.output;
    },

    // Reflection/revision/synthesis stay agent-agnostic on purpose: they
    // operate on already-produced TEXT across potentially several
    // different agents' outputs, not on any one agent's domain expertise
    // — the 'supervisor' agent (mirrors the frontend's own "المشرف" role)
    // is the natural, honest choice: same role, same job, here.
    async reflect(node: DagTaskDef, draftOutput: string, signal?: AbortSignal): Promise<ReflectionResult> {
      try {
        const supervisor = AgentRegistry.get('supervisor');
        const result = await runChatCompletion(
          {
            mode: supervisor.models,
            system: REFLECT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: `المهمة الفرعية: ${node.description}\n\nالناتج:\n${draftOutput}` }],
            maxTokens: 300,
            signal,
            route: 'runtime_plan',
            taskId: missionId,
          },
          gwCtx,
          obs
        );
        const textBlock = result.content.find((b) => b.type === 'text');
        const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '{}';
        const match = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(match ? match[0] : '{}') as { verdict?: string; critique?: string };
        return { verdict: parsed.verdict === 'revise' ? 'revise' : 'ok', critique: parsed.critique };
      } catch {
        return { verdict: 'ok' }; // same fail-open rule as dagRunner.ts's own reflect()
      }
    },

    async reviseNode(node: DagTaskDef, ctx: NodeRunContext, critique: string, signal?: AbortSignal): Promise<string> {
      const agentDef = AgentRegistry.selectAgentForTask(node.description);
      const result = await runAgentTask(agentDef.id, {
        agentId: agentDef.id,
        missionId,
        taskNodeId: node.id,
        taskDescription: `الهدف الكلي: ${ctx.goal}\n\nمهمتك الفرعية المحددة: ${node.description}\n\nملاحظة من مراجعة ذاتية سابقة يجب معالجتها: ${critique}`,
        upstreamOutputs: ctx.upstreamOutputs,
        gwCtx,
        signal,
      });
      return result.output;
    },

    async synthesize(goal: string, results: Record<string, string>, onToken: (t: string) => void, signal?: AbortSignal): Promise<string> {
      const supervisor = AgentRegistry.get('supervisor');
      const combined = Object.entries(results)
        .map(([id, out]) => `[${id}]:\n${out}`)
        .join('\n\n---\n\n');
      const result = await runChatCompletion(
        {
          mode: supervisor.models,
          system: SYNTHESIS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `الهدف الأصلي: ${goal}\n\nنتائج المهام الفرعية:\n${combined}` }],
          maxTokens: supervisor.policies.maxTokens,
          signal,
          route: 'runtime_plan',
          taskId: missionId,
        },
        gwCtx,
        obs,
        { onToken }
      );
      const textBlock = result.content.find((b) => b.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : '';
    },
  };
}
