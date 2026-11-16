// Tests that simulate distinct callers via X-Forwarded-For from a loopback client must now declare loopback as a trusted proxy (F06-a).
process.env.NEXUS_TRUST_PROXY = '127.0.0.1,::1';
export {};
