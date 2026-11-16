process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = 'secret-key-abc,another-key-xyz';
process.env.NEXUS_LOG_LEVEL = 'warn';
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '600';
process.env.NEXUS_RATE_LIMIT_BURST = '100';
export {};
