process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = '';
process.env.NEXUS_LOG_LEVEL = 'warn';
process.env.NEXUS_RATE_LIMIT_PER_MINUTE = '600';
process.env.NEXUS_RATE_LIMIT_BURST = '100';
process.env.NEXUS_MAX_RETRIES = '2'; // retries ENABLED — the privacy policy must hold on the retry path too, not only with retries off
process.env.NEXUS_RETRY_BASE_DELAY_MS = '5';
export {};
