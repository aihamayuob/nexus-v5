// Native-TLS test env. Bare side-effect import, listed FIRST (ServerConfig is read at import time).
// Generates a throw-away self-signed cert with openssl (test-only, temp dir). If openssl is missing, NEXUS_TEST_TLS_READY stays unset and the
// server-level TLS tests are SKIPPED with an explicit reason (the pure loader tests always run).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = 'TLS-test-key-aaaaaaaaaaaa-0001';
process.env.NEXUS_LOG_LEVEL = 'warn';
delete process.env.NEXUS_CORS_ORIGINS;
try {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-tls-test-'));
  const cert = path.join(dir, 'cert.pem'), key = path.join(dir, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-keyout', key, '-out', cert, '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'pipe' });
  process.env.NEXUS_TLS_CERT_FILE = cert;
  process.env.NEXUS_TLS_KEY_FILE = key;
  process.env.NEXUS_TEST_TLS_CA = readFileSync(cert, 'utf8');
  process.env.NEXUS_TEST_TLS_READY = '1';
} catch { /* openssl unavailable: server-level tests are skipped */ }
export {};
