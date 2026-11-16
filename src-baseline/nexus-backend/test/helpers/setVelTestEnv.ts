process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = '';
process.env.NEXUS_LOG_LEVEL = 'error'; // VEL tests deliberately provoke warn/critical paths; keep the TAP output readable
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '600';
process.env.NEXUS_RATE_LIMIT_BURST = '100';
process.env.NEXUS_MAX_RETRIES = '0';
export {};
