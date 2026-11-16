/**
 * RULE: provider API keys are read ONLY from process.env (via
 * config/providerRegistry.ts) and are used ONLY inside providers/*Adapter.ts
 * to build outgoing request headers to the provider's own API. They are
 * never:
 *   - included in any HTTP response body or header sent to a browser client
 *   - written to the SQLite database
 *   - passed to logger.* (the logger has no code path that would receive
 *     them, since nothing here ever puts a key into a `fields` object)
 *   - echoed back in error messages (provider adapters catch upstream
 *     errors and re-throw a NexusHttpError with a generic message; see
 *     each adapter's catch block)
 *
 * assertNoSecretLeak() is a cheap defense-in-depth check callable from
 * tests / route handlers right before res.json(...) on anything derived
 * from provider config, to catch a future accidental regression early.
 */
import { ProviderRegistry } from '../config/providerRegistry.js';

export function assertNoSecretLeak(payload: unknown): void {
  const secrets = ProviderRegistry.resolveAll()
    .map((p) => p.apiKey)
    .filter((k): k is string => !!k && k.length > 8); // ignore trivially short/placeholder values
  if (secrets.length === 0) return;
  const json = JSON.stringify(payload);
  for (const secret of secrets) {
    if (json.includes(secret)) {
      throw new Error('SECURITY INVARIANT VIOLATION: a provider API key was about to be included in a client-facing payload.');
    }
  }
}
