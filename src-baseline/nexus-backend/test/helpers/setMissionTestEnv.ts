process.env.NEXUS_DB_PATH = ':memory:';
process.env.NEXUS_GATEWAY_KEYS = '';
process.env.NEXUS_LOG_LEVEL = 'warn';
process.env.NEXUS_MAX_RETRIES = '1'; // real retry behavior, but fast — see missionRunner.test.ts's retry-limit test
process.env.NEXUS_MAX_CONCURRENCY_PER_PLAN = '4';
process.env.NEXUS_MAX_CONCURRENCY = '8';
