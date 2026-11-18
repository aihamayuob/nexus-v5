import { registerConnectors, type ConnectorImpl, type ConnectorManifest } from './connectorSdk.js';

/**
 * The code-level list of connectors registered at boot. Deliberately EMPTY by default: the reference connector (connectors/reference) is an example, and
 * adding any connector here is a reviewed code change (no dynamic loading of third-party code — the SDK provides no isolation, see connectorSdk.ts).
 */
export const FIRST_PARTY_CONNECTORS: Array<{ manifest: ConnectorManifest; impl: ConnectorImpl }> = [];

export function registerFirstPartyConnectors(): string[] {
  return registerConnectors(FIRST_PARTY_CONNECTORS);
}
