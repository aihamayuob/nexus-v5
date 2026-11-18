import { ServerConfig } from '../config/env.js';
import type { ToolDef } from '../providers/contract.js';
import { getToolRegistry, validateAgainstSchema } from '../tools/registry.js';
import type { ToolEffectSpec } from '../tools/effectTypes.js';
import { registerConnectorTool } from '../tools/bootstrap.js';

/**
 * NEXUS UNIVERSAL CONNECTOR SDK (C1) — ADR-007 §3. A small, versioned contract for adding a tool/connector WITHOUT touching core code:
 *   manifest (JSON-serialisable, validated) + implementation (execute() for pure/read_only, or a VEL `effect` spec for effectful) + a conformance kit.
 *
 * ENFORCED (each has a test in test/connectorSdk.test.ts): the effect declaration is mandatory and checked against the implementation shape;
 * an effectful connector is accepted ONLY with a VEL effect spec and VEL enabled, and then has NO execute() (reachable only through the VEL gate);
 * secrets are declared by env-var NAME, must exist at registration, and are readable only through ctx.secret(name) for declared names; secret-looking
 * literals in the manifest are refused; names are namespaced by rule and cannot collide with a registered tool.
 *
 * NOT PROVIDED — READ THIS: **no isolation.** Connector code runs IN-PROCESS with the privileges of the backend (no OS sandbox exists in NEXUS; the
 * `code_execution` tool stays unregistered for the same reason). ctx.secret() is an access-hygiene convention, not a security boundary against hostile code:
 * a connector can read process.env directly. Only first-party / code-reviewed connectors may be registered; the SDK has no dynamic loading of third-party
 * code by design (the boot list in connectors/registry.ts is a code-level array).
 */

export const MANIFEST_VERSION = 1;
export type ConnectorEffect = 'pure' | 'read_only' | 'effectful';

export interface ConnectorManifest {
  manifestVersion: 1;
  name: string;
  version: string;
  description: string;
  /** Mandatory declaration. 'effectful' requires a VEL effect spec. */
  effect: ConnectorEffect;
  /** Why this classification is right (>= 10 chars). An attestation, not a proof. */
  effectReason: string;
  inputSchema: NonNullable<ToolDef['input_schema']>;
  timeoutMs: number;
  /** Env-var NAMES only (never values). */
  requiredSecrets?: string[];
}

export interface ConnectorCallContext {
  taskId: string | null;
  caller: string;
  /** Returns the value of a DECLARED secret; throws for any other name. */
  secret(name: string): string;
}

export interface ConnectorImpl {
  execute?: (input: Record<string, unknown>, ctx: ConnectorCallContext) => Promise<string>;
  effect?: ToolEffectSpec;
}

export class ConnectorError extends Error {
  constructor(message: string) {
    super(`[C1] ${message}`);
    this.name = 'ConnectorError';
  }
}

const NAME_RE = /^[a-z][a-z0-9_]{2,40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const KEYS = new Set(['manifestVersion', 'name', 'version', 'description', 'effect', 'effectReason', 'inputSchema', 'timeoutMs', 'requiredSecrets']);
const PROP_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array']);
const SECRET_LITERAL = /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,})/;
const MAX_RESULT_CHARS = 20_000;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;

function walkStrings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => walkStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => walkStrings(x, out));
}

export function validateManifest(m: unknown, opts: { checkCollision?: boolean } = {}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return { ok: false, errors: ['manifest يجب أن يكون كائناً.'] };
  const o = m as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !KEYS.has(k));
  if (unknown.length) errors.push(`حقول غير مسموحة (unknown): ${unknown.join(', ')} — الأسرار تُعلن بالاسم في requiredSecrets فقط.`);
  if (o.manifestVersion !== MANIFEST_VERSION) errors.push(`manifestVersion يجب أن يساوي ${MANIFEST_VERSION}.`);
  if (typeof o.name !== 'string' || !NAME_RE.test(o.name) || o.name.startsWith('mcp__')) errors.push('name غير صالح (a-z و0-9 و_، 3-41 حرفاً، يبدأ بحرف، لا يبدأ بـ mcp__).');
  else if (opts.checkCollision !== false && getToolRegistry().get(o.name)) errors.push(`الاسم "${o.name}" مسجّل مسبقاً (already registered / collision).`);
  if (typeof o.version !== 'string' || !SEMVER_RE.test(o.version)) errors.push('version يجب أن يكون semver (x.y.z).');
  if (typeof o.description !== 'string' || o.description.trim().length < 5 || o.description.length > 1000) errors.push('description مطلوب (5-1000 حرف).');
  if (o.effect !== 'pure' && o.effect !== 'read_only' && o.effect !== 'effectful') errors.push('effect مطلوب ويجب أن يكون pure أو read_only أو effectful.');
  if (typeof o.effectReason !== 'string' || o.effectReason.trim().length < 10) errors.push('effectReason مطلوب (10 أحرف على الأقل).');
  if (typeof o.timeoutMs !== 'number' || !Number.isInteger(o.timeoutMs) || o.timeoutMs < 100 || o.timeoutMs > 120_000) errors.push('timeoutMs يجب أن يكون عدداً صحيحاً بين 100 و120000.');
  const s = o.inputSchema as { type?: unknown; properties?: unknown; required?: unknown } | undefined;
  if (!s || typeof s !== 'object' || s.type !== 'object' || typeof s.properties !== 'object' || s.properties === null || Array.isArray(s.properties)) {
    errors.push('inputSchema يجب أن يكون { type: "object", properties: {...} }.');
  } else {
    for (const [k, p] of Object.entries(s.properties as Record<string, unknown>)) {
      const t = (p as { type?: unknown } | null)?.type;
      if (typeof t !== 'string' || !PROP_TYPES.has(t)) errors.push(`inputSchema.properties.${k}.type غير صالح (type مطلوب من: ${[...PROP_TYPES].join('/')}).`);
    }
    if (s.required !== undefined) {
      if (!Array.isArray(s.required) || !s.required.every((r) => typeof r === 'string' && r in (s.properties as object))) errors.push('inputSchema.required يجب أن يسمّي خصائص موجودة في properties.');
    }
  }
  if (o.requiredSecrets !== undefined) {
    if (!Array.isArray(o.requiredSecrets) || !o.requiredSecrets.every((x) => typeof x === 'string' && ENV_RE.test(x))) errors.push('requiredSecrets يجب أن يكون قائمة بأسماء متغيرات بيئة (A-Z0-9_) لا قيماً — secret literal مرفوض.');
  }
  const strings: string[] = [];
  walkStrings({ ...o, requiredSecrets: undefined }, strings);
  if (strings.some((x) => SECRET_LITERAL.test(x))) errors.push('يبدو أن manifest يحتوي قيمة سر/اعتماد (credential literal) — ممنوع؛ استخدم requiredSecrets بالاسم.');
  return { ok: errors.length === 0, errors };
}

function checkShape(m: ConnectorManifest, impl: ConnectorImpl, velEnabled: boolean): string[] {
  const errors: string[] = [];
  if (m.effect === 'effectful') {
    if (!velEnabled) errors.push('الموصل effectful مرفوض: VEL معطّل (NEXUS_VEL_ENABLED=false).');
    if (!impl.effect) errors.push('الموصل effectful يتطلب VEL effect spec (مرفوض بلا بوابة VEL).');
    if (impl.execute) errors.push('الموصل effectful لا يجوز أن يحمل execute() — مساره الوحيد VEL.');
  } else {
    if (!impl.execute) errors.push('الموصل pure/read_only يتطلب execute().');
    if (impl.effect) errors.push('الموصل pure/read_only لا يجوز أن يحمل effect spec (تناقض في الإعلان).');
  }
  return errors;
}

function secretReader(m: ConnectorManifest): (name: string) => string {
  const declared = new Set(m.requiredSecrets ?? []);
  return (name) => {
    if (!declared.has(name)) throw new ConnectorError(`الموصل "${m.name}" لم يُعلن السر ${name} في requiredSecrets.`);
    const v = process.env[name];
    if (!v) throw new ConnectorError(`السر ${name} غير مضبوط.`);
    return v;
  };
}

export function registerConnector(manifest: ConnectorManifest, impl: ConnectorImpl, opts: { velEnabled?: boolean } = {}): void {
  const velEnabled = opts.velEnabled ?? ServerConfig.velEnabled;
  const v = validateManifest(manifest);
  const errors = v.ok ? checkShape(manifest, impl, velEnabled) : v.errors;
  if (errors.length === 0) {
    for (const s of manifest.requiredSecrets ?? []) if (!process.env[s]) errors.push(`السر المطلوب ${s} غير مضبوط في البيئة.`);
  }
  if (errors.length) throw new ConnectorError(`رفض الموصل "${String((manifest as { name?: unknown })?.name)}": ${errors.join(' | ')}`);

  const def: ToolDef = { name: manifest.name, description: manifest.description, input_schema: manifest.inputSchema };
  const secret = secretReader(manifest);
  if (manifest.effect === 'effectful') {
    registerConnectorTool({ def, timeoutMs: manifest.timeoutMs, effect: impl.effect! });
  } else {
    registerConnectorTool({
      def,
      timeoutMs: manifest.timeoutMs,
      effectClass: { kind: manifest.effect, reason: manifest.effectReason },
      execute: (input, meta) => impl.execute!(input, { taskId: meta?.taskId ?? null, caller: meta?.caller ?? 'unknown', secret }),
    });
  }
}

/** Boot path: all-or-nothing. The first invalid entry throws (the process must not start with a half-registered/unsafe connector set). */
export function registerConnectors(entries: Array<{ manifest: ConnectorManifest; impl: ConnectorImpl }>, opts: { velEnabled?: boolean } = {}): string[] {
  const done: string[] = [];
  try {
    for (const e of entries) {
      registerConnector(e.manifest, e.impl, opts);
      done.push(e.manifest.name);
    }
  } catch (err) {
    for (const n of done) getToolRegistry().unregister(n);
    throw err;
  }
  return done;
}

export interface ConformanceSamples {
  valid: Array<Record<string, unknown>>;
  invalid: Array<Record<string, unknown>>;
}
export interface ConformanceReport {
  passed: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

/** The kit a connector author runs. It exercises the connector directly (not through the registry), so it can run before registration. */
export async function runConformance(manifest: ConnectorManifest, impl: ConnectorImpl, samples: ConformanceSamples, opts: { velEnabled?: boolean } = {}): Promise<ConformanceReport> {
  const checks: ConformanceReport['checks'] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, ...(detail ? { detail } : {}) });
  const v = validateManifest(manifest, { checkCollision: false });
  add('manifest is valid', v.ok, v.errors.join(' | '));
  if (!v.ok) return { passed: false, checks };
  const shape = checkShape(manifest, impl, opts.velEnabled ?? true);
  add('implementation shape matches the declared effect', shape.length === 0, shape.join(' | '));
  const missing = (manifest.requiredSecrets ?? []).filter((s) => !process.env[s]);
  add('declared secrets are available', missing.length === 0, missing.join(','));
  add('samples provided (>=1 valid and >=1 invalid)', samples.valid.length >= 1 && samples.invalid.length >= 1);
  const schemaOk = samples.valid.every((s) => validateAgainstSchema(manifest.inputSchema, s).length === 0);
  add('every valid sample satisfies inputSchema', schemaOk);
  const rejects = samples.invalid.every((s) => validateAgainstSchema(manifest.inputSchema, s).length > 0);
  add('every invalid sample is rejected by inputSchema', rejects);
  if (manifest.effect === 'effectful') {
    const e = impl.effect;
    add('effect spec is complete (connector/operation/successCondition/dispatch/observe, bounded attempts)', !!e && !!e.connector && !!e.operation && (e.successCondition?.length ?? 0) >= 10 && typeof e.dispatch === 'function' && typeof e.observe === 'function' && e.maxAttempts >= 1);
    return { passed: checks.every((c) => c.ok), checks };
  }
  const secretValues = (manifest.requiredSecrets ?? []).map((s) => process.env[s] ?? '').filter((x) => x.length >= 8);
  const secret = secretReader(manifest);
  for (const [i, input] of samples.valid.entries()) {
    const label = `valid sample #${i + 1}`;
    try {
      const out = await Promise.race([
        impl.execute!(input, { taskId: null, caller: 'conformance', secret }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`exceeded timeoutMs=${manifest.timeoutMs}`)), manifest.timeoutMs)),
      ]);
      add(`${label}: returns a string within ${MAX_RESULT_CHARS} chars, no control characters, within timeoutMs`, typeof out === 'string' && out.length <= MAX_RESULT_CHARS && !CONTROL.test(out), typeof out === 'string' ? `length=${out.length}` : 'not a string');
      add(`${label}: result does not contain any declared secret value`, !secretValues.some((sv) => String(out).includes(sv)));
    } catch (e) {
      add(`${label}: executes without throwing and within timeoutMs`, false, (e as Error).message);
    }
  }
  return { passed: checks.every((c) => c.ok), checks };
}
