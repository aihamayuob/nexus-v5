/**
 * Release V1 · B4 — startup deployment guard.
 *
 * Rule: the backend may only be reachable from the network when gateway
 * authentication is configured. Trusted/no-auth mode (empty
 * NEXUS_GATEWAY_KEYS) is accepted ONLY while the listener is bound to a
 * loopback address. There is deliberately NO override flag for "insecure
 * network mode".
 *
 * Pure function + a thin enforcer so the policy is testable without
 * spawning a process. Error/warning text never contains a key value.
 *
 * Scope limits (disclosed in docs/DEPLOYMENT-LAN.md): this does not add
 * TLS (the bearer key crosses the LAN in clear over plain HTTP), does not
 * make the release suitable for the public internet, and does not govern
 * the opt-in MQTT listener (NEXUS_MQTT_PORT, default off, per-device auth,
 * binds all interfaces when enabled).
 */
import { ServerConfig } from './env.js';

export const MIN_GATEWAY_KEY_LENGTH = 16;

export interface DeploymentInput {
  host: string;
  gatewayKeys: readonly string[];
}

export interface DeploymentVerdict {
  ok: boolean;
  /** true when the listen address is reachable from other machines (anything not loopback). */
  networkExposed: boolean;
  errors: string[];
  warnings: string[];
}

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  if (/^::ffff:127\./.test(h)) return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function evaluateDeployment(input: DeploymentInput): DeploymentVerdict {
  const errors: string[] = [];
  const warnings: string[] = [];
  const networkExposed = !isLoopbackHost(input.host);
  const keys = input.gatewayKeys;

  if (keys.length === 0) {
    if (networkExposed) {
      errors.push(
        `NEXUS_HOST="${input.host}" exposes the backend to the network but NEXUS_GATEWAY_KEYS is empty. ` +
          `Set NEXUS_GATEWAY_KEYS (at least ${MIN_GATEWAY_KEY_LENGTH} characters per key) or bind to 127.0.0.1.`,
      );
    } else {
      warnings.push('NEXUS_GATEWAY_KEYS is empty: running in trusted/no-auth mode, acceptable only because the listener is loopback-only.');
    }
  } else if (networkExposed) {
    const seen = new Set<string>();
    keys.forEach((k, i) => {
      if (k.length < MIN_GATEWAY_KEY_LENGTH) errors.push(`NEXUS_GATEWAY_KEYS entry #${i + 1} is shorter than ${MIN_GATEWAY_KEY_LENGTH} characters.`);
      if (/\s/.test(k)) errors.push(`NEXUS_GATEWAY_KEYS entry #${i + 1} contains whitespace.`);
      if (seen.has(k)) errors.push(`NEXUS_GATEWAY_KEYS entry #${i + 1} is a duplicate.`);
      seen.add(k);
    });
  }

  if (networkExposed && errors.length === 0) {
    warnings.push('Network-exposed over plain HTTP: the gateway key travels unencrypted. Intended for a trusted LAN only — NOT for the public internet.');
  }
  return { ok: errors.length === 0, networkExposed, errors, warnings };
}

export class DeploymentConfigError extends Error {
  constructor(public readonly verdict: DeploymentVerdict) {
    super(`Refusing to start: ${verdict.errors.join(' ')}`);
    this.name = 'DeploymentConfigError';
  }
}

/** Throws DeploymentConfigError when the configured deployment is unsafe; returns the verdict (with warnings) otherwise. */
export function enforceDeployment(cfg: DeploymentInput = ServerConfig): DeploymentVerdict {
  const verdict = evaluateDeployment(cfg);
  if (!verdict.ok) throw new DeploymentConfigError(verdict);
  return verdict;
}
