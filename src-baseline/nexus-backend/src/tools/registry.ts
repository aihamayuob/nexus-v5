import type { ToolDef } from '../providers/contract.js';
import type { EffectClassification, ToolEffectSpec } from './effectTypes.js';

/** Minimum length of a classification `reason` / `compensatingControls` — a speed bump against placeholders ("x", "ok"), NOT a quality check. */
const MIN_ATTESTATION_CHARS = 10;

/** Per-call context a tool MAY use (pipeline passes it; existing tools ignore it). `caller` is the provider id (or 'mcp') that triggered the call; `taskId` the owning task. */
export interface ToolExecuteMeta {
  taskId?: string | null;
  caller?: string;
}

export interface RegisteredTool {
  def: ToolDef;
  /** Absent for server-native tools the provider itself executes (e.g. Anthropic's web_search_20250305) — those never reach our pipeline at all. Also absent for VEL tools (`effect` set): their only execution path is effect.dispatch() behind the VEL gate. */
  execute?: (input: Record<string, unknown>, meta?: ToolExecuteMeta) => Promise<string>;
  timeoutMs: number;
  /** VEL opt-in: a tool with an external effect declares it here instead of `execute` (see tools/effectTypes.ts and tools/verifiedExecution.ts). */
  effect?: ToolEffectSpec;
  /** VEL gap G8: REQUIRED for any tool that keeps `execute()`; forbidden together with `effect`. See tools/effectTypes.ts (EffectClassification). */
  effectClass?: EffectClassification;
}

function assertValidClassification(name: string, c: unknown): asserts c is EffectClassification {
  const bad = (why: string): never => {
    throw new Error(`[VEL/G8] الأداة "${name}": تصنيف الأثر غير صالح — ${why}`);
  };
  if (typeof c !== 'object' || c === null) return bad('مطلوب effectClass.');
  const o = c as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (o.kind !== 'pure' && o.kind !== 'read_only' && o.kind !== 'legacy_exempt') return bad('kind يجب أن يكون pure أو read_only أو legacy_exempt.');
  if (text(o.reason).length < MIN_ATTESTATION_CHARS) return bad(`reason مطلوب (${MIN_ATTESTATION_CHARS} أحرف على الأقل).`);
  if (o.kind === 'legacy_exempt' && text(o.compensatingControls).length < MIN_ATTESTATION_CHARS) {
    return bad(`legacy_exempt يتطلب compensatingControls (${MIN_ATTESTATION_CHARS} أحرف على الأقل).`);
  }
}

class ToolRegistryImpl {
  private tools = new Map<string, RegisteredTool>();

  /**
   * VEL gap G8 invariants (violations throw, so a bad tool fails boot instead of silently bypassing the gate):
   *  1. `effect` and `execute` are mutually exclusive — an effectful tool's ONLY path to its effect is the VEL gate.
   *  2. `effect` and `effectClass` are mutually exclusive — contradictory declarations.
   *  3. A tool with `execute` and no `effect` must carry a valid `effectClass`.
   * A tool with neither `execute` nor `effect` is not executable by our pipeline (it reports "not registered/executable") and is accepted unchanged.
   * The stored entry is a frozen shallow copy, so the registered tool cannot later gain `execute`, lose `effect`, or change its classification in place.
   */
  register(tool: RegisteredTool) {
    const name = tool.def.name;
    if (tool.effect && tool.execute) throw new Error(`[VEL/G8] الأداة "${name}": لا يجوز الجمع بين effect وexecute().`);
    if (tool.effect && tool.effectClass) throw new Error(`[VEL/G8] الأداة "${name}": لا يجوز الجمع بين effect وeffectClass.`);
    if (tool.execute && !tool.effect) assertValidClassification(name, tool.effectClass);
    this.tools.set(name, Object.freeze({ ...tool, effectClass: tool.effectClass ? Object.freeze({ ...tool.effectClass }) : undefined }));
  }

  /** Names of registered tools classified `legacy_exempt` (can cause external effects, not VEL-gated). Reviewable list; pinned by test/toolEffectClassification.test.ts. */
  listLegacyExemptions(): string[] {
    return [...this.tools.values()].filter((t) => t.effectClass?.kind === 'legacy_exempt').map((t) => t.def.name);
  }

  /** Removes a tool (used by the MCP client's kill-switch / reconnect). Returns whether it existed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()].map((t) => t.def);
  }

  clear() {
    this.tools.clear();
  }
}

let singleton: ToolRegistryImpl | null = null;
export function getToolRegistry(): ToolRegistryImpl {
  if (!singleton) singleton = new ToolRegistryImpl();
  return singleton;
}

/** Minimal JSON-schema-lite validator — deliberately not a general-purpose engine (zero external deps), just enough to validate our own tool input_schema shapes (object/string/number/boolean properties + required). */
export function validateAgainstSchema(schema: ToolDef['input_schema'], input: unknown): string[] {
  const errors: string[] = [];
  if (!schema) return errors;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['المدخل يجب أن يكون كائن (object).'];
  }
  const obj = input as Record<string, unknown>;
  for (const required of schema.required ?? []) {
    if (!(required in obj)) errors.push(`الحقل المطلوب "${required}" مفقود.`);
  }
  for (const [key, propSchema] of Object.entries(schema.properties)) {
    if (!(key in obj)) continue;
    const value = obj[key];
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (propSchema.type === 'string' && actualType !== 'string') errors.push(`الحقل "${key}" يجب أن يكون نصاً.`);
    if (propSchema.type === 'number' && actualType !== 'number') errors.push(`الحقل "${key}" يجب أن يكون رقماً.`);
    if (propSchema.type === 'boolean' && actualType !== 'boolean') errors.push(`الحقل "${key}" يجب أن يكون قيمة منطقية.`);
    if (propSchema.type === 'object' && actualType !== 'object') errors.push(`الحقل "${key}" يجب أن يكون كائناً.`);
  }
  return errors;
}
