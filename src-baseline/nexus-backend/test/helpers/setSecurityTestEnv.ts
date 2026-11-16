// Release V1 · B4 — env for test/securityHeaders.test.ts and test/gatewayKeyLeak.test.ts.
// Bare side-effect import, listed FIRST (see setCorsTestEnv.ts for why order matters).
// Keys are long enough to satisfy the deployment guard; rate limit is tiny so a 429 can be provoked on purpose.
process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = 'LAN-test-key-aaaaaaaaaaaa-0001,LAN-test-key-bbbbbbbbbbbb-0002';
process.env.NEXUS_LOG_LEVEL = 'info';
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '1';
process.env.NEXUS_RATE_LIMIT_BURST = '5';
delete process.env.NEXUS_CORS_ORIGINS;
export {};
