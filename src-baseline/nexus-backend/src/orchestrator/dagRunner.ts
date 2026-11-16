import type { ProviderId } from '../config/providerRegistry.js';
import { runChatCompletion } from './chatService.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import type { TaskObservability } from '../observability/recorder.js';
import type { DagTaskDef } from './dagTypes.js';
import type { NodeRunContext, ReflectionResult } from './dag.js';

const NODE_SYSTEM_PROMPT = `أنت وكيل ينفّذ مهمة فرعية واحدة ضمن خطة أكبر متعددة الخطوات. نفّذ مهمتك الفرعية تحديداً بشكل مباشر وعملي ومختصر — لا تكرر الهدف الكلي، ولا تشرح أنك ستنفذ المهمة، فقط أنجزها.`;

const REFLECT_SYSTEM_PROMPT = `أنت مراجع ذاتي صارم لناتج مهمة فرعية واحدة. أجب حصراً بصيغة JSON: {"verdict":"ok"|"revise","critique":"سبب موجز إن كان يحتاج مراجعة"}. لا تطلب مراجعة إلا لسبب حقيقي (نقص جوهري، خطأ واضح) — التحسين الشكلي البسيط لا يستحق جولة إضافية.`;

const SYNTHESIS_SYSTEM_PROMPT = `اِدمج نتائج المهام الفرعية التالية في إجابة نهائية واحدة متماسكة تلبي الهدف الأصلي الكلي. نظّم الإجابة بعناوين واضحة حسب الحاجة، ولا تكرر عرض كل نتيجة فرعية حرفياً — لخّص ووحّد.`;

function buildUserContext(node: DagTaskDef, ctx: NodeRunContext, extra?: string): string {
  let msg = `الهدف الكلي: ${ctx.goal}\n\nمهمتك الفرعية المحددة: ${node.description}`;
  const upstreamEntries = Object.entries(ctx.upstreamOutputs);
  if (upstreamEntries.length) {
    msg += '\n\nنتائج مهام سابقة ذات صلة:\n' + upstreamEntries.map(([id, out]) => `[${id}]: ${out}`).join('\n\n');
  }
  if (extra) msg += `\n\n${extra}`;
  return msg;
}

export interface DagRunnerDeps {
  runNode: (node: DagTaskDef, ctx: NodeRunContext, signal?: AbortSignal) => Promise<string>;
  reflect: (node: DagTaskDef, draftOutput: string, signal?: AbortSignal) => Promise<ReflectionResult>;
  reviseNode: (node: DagTaskDef, ctx: NodeRunContext, critique: string, signal?: AbortSignal) => Promise<string>;
  synthesize: (goal: string, results: Record<string, string>, onToken: (t: string) => void, signal?: AbortSignal) => Promise<string>;
}

export function createDagRunner(providerId: ProviderId, gwCtx: GatewayContext, obs: TaskObservability, taskId: string): DagRunnerDeps {
  return {
    async runNode(node, ctx, signal) {
      obs.recordAgent(node.id);
      const result = await runChatCompletion(
        {
          provider: providerId,
          system: NODE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserContext(node, ctx) }],
          maxTokens: 1200,
          signal,
          route: 'runtime_plan',
          taskId,
        },
        gwCtx,
        obs
      );
      const textBlock = result.content.find((b) => b.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : '';
    },

    async reflect(node, draftOutput, signal) {
      try {
        const result = await runChatCompletion(
          {
            provider: providerId,
            system: REFLECT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: `المهمة الفرعية: ${node.description}\n\nالناتج:\n${draftOutput}` }],
            maxTokens: 300,
            signal,
            route: 'runtime_plan',
            taskId,
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
        // Reflection is a quality nice-to-have, never a hard requirement —
        // if it fails for any reason, treat as "ok" rather than blocking the node.
        return { verdict: 'ok' };
      }
    },

    async reviseNode(node, ctx, critique, signal) {
      const result = await runChatCompletion(
        {
          provider: providerId,
          system: NODE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserContext(node, ctx, `ملاحظة من مراجعة ذاتية سابقة يجب معالجتها: ${critique}`) }],
          maxTokens: 1200,
          signal,
          route: 'runtime_plan',
          taskId,
        },
        gwCtx,
        obs
      );
      const textBlock = result.content.find((b) => b.type === 'text');
      return textBlock && textBlock.type === 'text' ? textBlock.text : '';
    },

    async synthesize(goal, results, onToken, signal) {
      const combined = Object.entries(results)
        .map(([id, out]) => `[${id}]:\n${out}`)
        .join('\n\n---\n\n');
      const result = await runChatCompletion(
        {
          provider: providerId,
          system: SYNTHESIS_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: `الهدف الأصلي: ${goal}\n\nنتائج المهام الفرعية:\n${combined}` }],
          maxTokens: 2000,
          signal,
          route: 'runtime_plan',
          taskId,
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
