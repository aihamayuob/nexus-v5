process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = 'secret-key-abc-0123456789,another-key-xyz-0123456789';
process.env.NEXUS_LOG_LEVEL = 'error';
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '60';
process.env.NEXUS_RATE_LIMIT_BURST = '10';
export {};
