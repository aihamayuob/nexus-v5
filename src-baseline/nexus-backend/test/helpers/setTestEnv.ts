process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_PORT = '0'; // unused directly by tests (we call createNexusServer + .listen(0) ourselves), but keep it harmless
process.env.NEXUS_GATEWAY_KEYS = ''; // trusted/no-auth mode for the main integration suite
process.env.NEXUS_LOG_LEVEL = 'warn'; // keep test output readable
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '600';
process.env.NEXUS_RATE_LIMIT_BURST = '100';
export {};
