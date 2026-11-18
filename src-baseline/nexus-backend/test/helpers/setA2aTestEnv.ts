import './setAuthTestEnv.js';
process.env.NEXUS_A2A_PROVIDER = 'anthropic';
process.env.NEXUS_ANTHROPIC_API_KEY = 'fake-anthropic-key-a2a';
process.env.NEXUS_MODEL_ANTHROPIC = 'claude-a2a-test';
process.env.NEXUS_MAX_RETRIES = '0';
export {};
