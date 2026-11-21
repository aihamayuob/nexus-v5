import { readFileSync } from 'node:fs';

export interface TlsMaterial { cert: Buffer; key: Buffer }

/**
 * Optional native TLS (NEXUS_TLS_CERT_FILE + NEXUS_TLS_KEY_FILE). Both empty => plain HTTP (the historical default, unchanged).
 * Exactly one set, or an unreadable file => throw at startup (fail closed: never silently fall back to plaintext when TLS was requested).
 * Error messages carry the errno code only — never a file's contents.
 */
export function loadTlsMaterial(certFile: string, keyFile: string): TlsMaterial | null {
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) throw new Error('NEXUS_TLS_CERT_FILE and NEXUS_TLS_KEY_FILE must be set together');
  try {
    return { cert: readFileSync(certFile), key: readFileSync(keyFile) };
  } catch (e) {
    throw new Error(`cannot read the TLS certificate/key file (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
}
