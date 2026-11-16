import { createHash } from 'node:crypto';
import { ServerConfig } from '../config/env.js';
import { logger } from '../core/logger.js';
import type { GatewayContext } from '../capability/permissionModel.js';
import { getRepos } from '../persistence/repos.js';

/**
 * NEXUS VEL — execution-time policy decision for tools that declare an external effect (tools/effectTypes.ts).
 *
 * DEFAULT-DENY: an effectful action runs only if an explicit allow-rule matches (tool + resource + actor) AND the task/actor preconditions hold.
 * The decision is computed from values the SERVER holds (the gateway context, the task id passed by the orchestrator, the canonicalised parameters
 * that will actually be dispatched) — never from model text or a request field. It is evaluated at EVERY dispatch attempt, not only at planning.
 *
 * Rule source: NEXUS_VEL_POLICY_JSON (JSON array of EffectPolicyRule). Missing/invalid => zero rules => deny everything (fail-closed).
 * Policy version = a digest of the active rules, recorded on every receipt, so "which policy allowed this" is answerable later.
 *
 * Honest limit: single-tenant system by documented owner decision (capability/permissionModel.ts) — `actors` narrows by the server-derived client id
 * but there is no per-user identity beyond that. No human-approval step is bound to a specific action here (HIGH_RISK task approval exists at task level only).
 */
export interface EffectPolicyRule {
  id: string;
  tool: string;
  /** Allowed resources: exact strings, or a prefix ending in a single '*' (e.g. "ledger/team-a/*"). A bare "*" is rejected as too broad. */
  resources: string[];
  /** Optional: only these server-derived client ids (GatewayContext.clientKey) may use the rule. Absent = any authenticated, non-public actor. */
  actors?: string[];
  /** Optional hard bound on non-denied actions per task for this tool. */
  maxCallsPerTask?: number;
}

export interface EffectPolicyContext {
  toolName: string;
  resource: string;
  taskId: string | null;
  gw: GatewayContext;
  /** true on a retry attempt of an already-started action: re-evaluates everything EXCEPT the per-task call bound (the action itself is already counted). */
  isRetry?: boolean;
}

export interface EffectPolicyDecision {
  allow: boolean;
  reason: string;
  ruleId: string | null;
  policyVersion: string;
}

const POLICY_SCHEMA = 'vel-policy/1';
let override: EffectPolicyRule[] | null = null;
let cachedEnv: { raw: string; rules: EffectPolicyRule[] } | null = null;

function validRule(r: unknown): r is EffectPolicyRule {
  if (!r || typeof r !== 'object') return false;
  const x = r as Record<string, unknown>;
  if (typeof x.id !== 'string' || !x.id || typeof x.tool !== 'string' || !x.tool) return false;
  if (!Array.isArray(x.resources) || x.resources.length === 0) return false;
  for (const p of x.resources) {
    if (typeof p !== 'string' || !p || p === '*') return false;
    const star = p.indexOf('*');
    if (star !== -1 && star !== p.length - 1) return false;
  }
  if (x.actors !== undefined && (!Array.isArray(x.actors) || x.actors.some((a) => typeof a !== 'string'))) return false;
  if (x.maxCallsPerTask !== undefined && (!Number.isInteger(x.maxCallsPerTask) || (x.maxCallsPerTask as number) < 1)) return false;
  return true;
}

function loadFromEnv(): EffectPolicyRule[] {
  const raw = ServerConfig.velPolicyJson;
  if (cachedEnv && cachedEnv.raw === raw) return cachedEnv.rules;
  let rules: EffectPolicyRule[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every(validRule)) rules = parsed;
      else logger.error('NEXUS_VEL_POLICY_JSON is not a valid rule array — treating as NO rules (default-deny)');
    } catch {
      logger.error('NEXUS_VEL_POLICY_JSON is not valid JSON — treating as NO rules (default-deny)');
    }
  }
  cachedEnv = { raw, rules };
  return rules;
}

function activeRules(): EffectPolicyRule[] {
  return override ?? loadFromEnv();
}

export function policyVersion(rules: EffectPolicyRule[] = activeRules()): string {
  return `${POLICY_SCHEMA}:${createHash('sha256').update(JSON.stringify(rules)).digest('hex').slice(0, 12)}`;
}

/** Test/ops seam: replaces the env-derived rules in-process. Pass null to go back to NEXUS_VEL_POLICY_JSON. Invalid rules are dropped to an empty set (deny-all). */
export function setEffectPolicyRules(rules: EffectPolicyRule[] | null): void {
  override = rules === null ? null : rules.every(validRule) ? rules : [];
}

function resourceMatches(pattern: string, resource: string): boolean {
  return pattern.endsWith('*') ? resource.startsWith(pattern.slice(0, -1)) : pattern === resource;
}

/** Resources are policy scope keys: refuse anything that could widen a prefix match or smuggle path/control characters. */
export function isSafeResource(resource: unknown): resource is string {
  // eslint-disable-next-line no-control-regex
  return typeof resource === 'string' && resource.length > 0 && resource.length <= 200 && !/[\x00-\x1F\\*]/.test(resource) && !resource.split('/').some((seg) => seg === '..' || seg === '.');
}

export function decideEffectPolicy(c: EffectPolicyContext): EffectPolicyDecision {
  const rules = activeRules();
  const version = policyVersion(rules);
  const deny = (reason: string, ruleId: string | null = null): EffectPolicyDecision => ({ allow: false, reason, ruleId, policyVersion: version });

  if (!ServerConfig.velEnabled) return deny('vel_disabled');
  if (!c.gw || c.gw.authenticated !== true) return deny('actor_not_authenticated');
  // skipAuth routes are given a synthetic `public:<ip>` context by the router — never a principal allowed to cause an external effect.
  if (c.gw.clientKey.startsWith('public:')) return deny('actor_is_public_context');
  if (!c.taskId) return deny('no_task_scope');
  if (!isSafeResource(c.resource)) return deny('invalid_resource');
  if (rules.length === 0) return deny('no_policy_rules_default_deny');

  const candidates = rules.filter((r) => r.tool === c.toolName);
  if (candidates.length === 0) return deny('no_rule_for_tool');
  const rule = candidates.find((r) => r.resources.some((p) => resourceMatches(p, c.resource)) && (!r.actors || r.actors.includes(c.gw.clientKey)));
  if (!rule) return deny('no_matching_allow_rule');
  if (!c.isRetry && rule.maxCallsPerTask !== undefined && getRepos().executionReceipts.countStartedForTask(c.taskId, c.toolName) >= rule.maxCallsPerTask) {
    return deny('max_calls_per_task_reached', rule.id);
  }
  return { allow: true, reason: 'allowed_by_rule', ruleId: rule.id, policyVersion: version };
}
