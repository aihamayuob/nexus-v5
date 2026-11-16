import type { RegisteredTool } from '../registry.js';
import { Sandbox } from '../../sandbox/sandbox.js';
import { ServerConfig } from '../../config/env.js';
import { Errors } from '../../core/errors.js';

function formatResult(r: Awaited<ReturnType<typeof Sandbox.runCode>>): string {
  const parts: string[] = [];
  if (r.timedOut) parts.push(`[انتهت المهلة بعد ${ServerConfig.codeExecutionTimeoutMs}ms — تم إنهاء العملية]`);
  if (r.truncated) parts.push('[تنبيه: تم اقتطاع الناتج لتجاوزه الحد المسموح]');
  parts.push(`exit_code: ${r.exitCode ?? 'null'}`);
  if (r.stdout) parts.push(`stdout:\n${r.stdout}`);
  if (r.stderr) parts.push(`stderr:\n${r.stderr}`);
  return parts.join('\n');
}

export const codeExecutionTool: RegisteredTool = {
  def: {
    name: 'code_execution',
    description:
      'نفّذ كوداً قصيراً (JavaScript عبر Node.js أو Python) داخل بيئة معزولة جزئياً (Sandbox) وأعد stdout/stderr. استخدمه للحسابات أو معالجة البيانات التي تتجاوز قدرة أداة calculate. تنبيه: هذا عزل جزئي (حد زمني وحد ناتج فقط) وليس عزلاً كاملاً على مستوى نظام التشغيل — لا تُدخل أسراراً أو بيانات حساسة في الكود.',
    input_schema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: "'javascript' أو 'python'" },
        code: { type: 'string', description: 'الكود الكامل المطلوب تنفيذه.' },
      },
      required: ['language', 'code'],
    },
  },
  // A bit above ServerConfig.codeExecutionTimeoutMs so Sandbox's own internal
  // timeout is what actually fires first (and reports timedOut cleanly),
  // rather than the tool pipeline's outer withTimeout() racing it.
  timeoutMs: ServerConfig.codeExecutionTimeoutMs + 2_000,
  // Honest classification (see sandbox/sandbox.ts header): the child process has NO filesystem jail and NO network isolation, so once enabled it CAN cause
  // external effects. It is therefore NOT 'pure'/'read_only'; it stays outside VEL as an explicit, pinned legacy exemption pending an owner decision.
  effectClass: {
    kind: 'legacy_exempt',
    reason: 'الكود المنفَّذ قد يكتب ملفات خارج مجلد العمل ويرسل طلبات شبكة ويُنشئ عمليات فرعية (لا عزل على مستوى OS).',
    compensatingControls: 'مغلقة افتراضيًا (NEXUS_ENABLE_CODE_EXECUTION_TOOL=false)؛ بيئة مصغّرة بلا أسرار؛ مهلة وحد ناتج وحد تزامن؛ كل تنفيذ يُدقَّق عبر auditSecurityEvent.',
  },
  async execute(input) {
    const language = String(input.language ?? '');
    if (language !== 'javascript' && language !== 'python') {
      throw Errors.toolValidation('الحقل "language" يجب أن يكون "javascript" أو "python".');
    }
    const code = String(input.code ?? '');
    if (!code.trim()) throw Errors.toolValidation('الحقل "code" فارغ.');
    const result = await Sandbox.runCode(language, code);
    return formatResult(result);
  },
};
