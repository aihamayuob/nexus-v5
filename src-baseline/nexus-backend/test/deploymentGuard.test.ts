// Release V1 · B4 (G1–G3, G7): deployment guard policy, loopback default, and the REAL process refusing / starting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { evaluateDeployment, enforceDeployment, isLoopbackHost, DeploymentConfigError, MIN_GATEWAY_KEY_LENGTH } = await import('../src/config/deploymentGuard.js');

const GOOD_KEY = 'LAN-test-key-aaaaaaaaaaaa-0001';
const GOOD_KEY2 = 'LAN-test-key-bbbbbbbbbbbb-0002';

// ---------- G1: pure policy ----------
for (const host of ['127.0.0.1', '127.0.1.1', '::1', '[::1]', 'localhost', 'LOCALHOST']) {
  test(`G1 loopback host ${host}: allowed with no keys (warning only), not network-exposed`, () => {
    assert.equal(isLoopbackHost(host), true);
    const v = evaluateDeployment({ host, gatewayKeys: [] });
    assert.equal(v.ok, true);
    assert.equal(v.networkExposed, false);
    assert.ok(v.warnings.length >= 1);
  });
}

for (const host of ['0.0.0.0', '::', '192.168.1.20', '10.0.0.5', 'nexus.lan', '172.16.0.9']) {
  test(`G1 non-loopback host ${host} + NO keys is REFUSED and names NEXUS_GATEWAY_KEYS`, () => {
    assert.equal(isLoopbackHost(host), false);
    const v = evaluateDeployment({ host, gatewayKeys: [] });
    assert.equal(v.ok, false);
    assert.equal(v.networkExposed, true);
    assert.match(v.errors.join(' '), /NEXUS_GATEWAY_KEYS/);
    assert.throws(() => enforceDeployment({ host, gatewayKeys: [] }), DeploymentConfigError);
  });
}

test('G1 non-loopback + valid keys is accepted, with the plain-HTTP/LAN-only warning', () => {
  const v = evaluateDeployment({ host: '0.0.0.0', gatewayKeys: [GOOD_KEY, GOOD_KEY2] });
  assert.equal(v.ok, true);
  assert.equal(v.networkExposed, true);
  assert.match(v.warnings.join(' '), /NOT for the public internet/);
  assert.doesNotThrow(() => enforceDeployment({ host: '0.0.0.0', gatewayKeys: [GOOD_KEY] }));
});

test('G1 non-loopback: a short key, a key with whitespace and a duplicate key are each refused; the key value is never echoed', () => {
  const short = 'short-secret-1';
  assert.ok(short.length < MIN_GATEWAY_KEY_LENGTH);
  for (const keys of [[short], [GOOD_KEY, short], ['has space inside-0123456789'], [GOOD_KEY, GOOD_KEY]]) {
    const v = evaluateDeployment({ host: '0.0.0.0', gatewayKeys: keys });
    assert.equal(v.ok, false, JSON.stringify(keys.map((k) => k.length)));
    const text = [...v.errors, ...v.warnings].join(' ');
    for (const k of keys) assert.ok(!text.includes(k), 'verdict text must not contain a key value');
    try {
      enforceDeployment({ host: '0.0.0.0', gatewayKeys: keys });
      assert.fail('should have thrown');
    } catch (e) {
      for (const k of keys) assert.ok(!(e as Error).message.includes(k), 'error message must not contain a key value');
    }
  }
});

test('G1 loopback + short key is NOT refused (the length rule only guards network exposure)', () => {
  assert.equal(evaluateDeployment({ host: '127.0.0.1', gatewayKeys: ['abc'] }).ok, true);
});

// ---------- G2: default host ----------
test('G2 ServerConfig.host defaults to loopback when NEXUS_HOST is unset', async () => {
  const saved = process.env.NEXUS_HOST;
  delete process.env.NEXUS_HOST;
  try {
    const { ServerConfig } = await import(`../src/config/env.js?default-host-${Date.now()}`);
    assert.equal(ServerConfig.host, '127.0.0.1');
  } finally {
    if (saved !== undefined) process.env.NEXUS_HOST = saved;
  }
});

// ---------- G3: real process ----------
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}
function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect({ port, host: '127.0.0.1' });
    c.once('connect', () => { c.destroy(); resolve(true); });
    c.once('error', () => resolve(false));
  });
}
function launch(env: Record<string, string | undefined>) {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NEXUS_DB_PATH: ':memory:', NEXUS_LOG_LEVEL: 'info', ...env };
  for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
  const child = spawn(process.execPath, [...process.execArgv, 'src/index.ts'], { cwd: backendDir, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, exited, output: () => out };
}
async function waitFor(pred: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('G3 real process: NEXUS_HOST=0.0.0.0 with NO keys exits non-zero and never listens', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const p = launch({ NEXUS_HOST: '0.0.0.0', NEXUS_PORT: String(port), NEXUS_GATEWAY_KEYS: '' });
  const code = await Promise.race([p.exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 45_000))]);
  if (code === 'timeout') p.child.kill('SIGKILL');
  assert.notEqual(code, 'timeout', 'process must exit by itself');
  assert.notEqual(code, 0);
  assert.match(p.output(), /NEXUS_GATEWAY_KEYS/);
  assert.equal(await canConnect(port), false, 'nothing may be listening on the port');
});

test('G3 real process: network bind with a SHORT key is refused and the key is not printed', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const shortKey = 'tiny-key-9';
  const p = launch({ NEXUS_HOST: '0.0.0.0', NEXUS_PORT: String(port), NEXUS_GATEWAY_KEYS: shortKey });
  const code = await Promise.race([p.exited, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 45_000))]);
  if (code === 'timeout') p.child.kill('SIGKILL');
  assert.notEqual(code, 'timeout');
  assert.notEqual(code, 0);
  assert.ok(!p.output().includes(shortKey));
  assert.equal(await canConnect(port), false);
});

test('G3 real process: default host (no NEXUS_HOST, no keys) starts on loopback and answers /v2/health', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const p = launch({ NEXUS_PORT: String(port), NEXUS_HOST: undefined, NEXUS_GATEWAY_KEYS: '' });
  try {
    assert.equal(await waitFor(() => canConnect(port), 40_000), true, `did not start: ${p.output()}`);
    const res = await fetch(`http://127.0.0.1:${port}/v2/health`);
    assert.equal(res.status, 200);
    assert.match(p.output(), /"host":"127\.0\.0\.1"/);
  } finally {
    p.child.kill('SIGTERM');
    await Promise.race([p.exited, new Promise((r) => setTimeout(r, 7000))]);
    p.child.kill('SIGKILL');
  }
});

test('G3 real process: network bind WITH valid keys starts, enforces auth, and does not print the keys', { timeout: 60_000 }, async () => {
  const port = await freePort();
  const p = launch({ NEXUS_HOST: '0.0.0.0', NEXUS_PORT: String(port), NEXUS_GATEWAY_KEYS: `${GOOD_KEY},${GOOD_KEY2}` });
  try {
    assert.equal(await waitFor(() => canConnect(port), 40_000), true, `did not start: ${p.output()}`);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v2/models`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${port}/v2/models`, { headers: { Authorization: `Bearer ${GOOD_KEY}` } })).status, 200);
    assert.ok(!p.output().includes(GOOD_KEY) && !p.output().includes(GOOD_KEY2), 'keys must not appear in process output');
  } finally {
    p.child.kill('SIGTERM');
    await Promise.race([p.exited, new Promise((r) => setTimeout(r, 7000))]);
    p.child.kill('SIGKILL');
  }
});

// ---------- G7: .env.example ----------
test('G7 .env.example ships a loopback host, documents the key requirement and contains no real key', () => {
  const text = readFileSync(path.join(backendDir, '.env.example'), 'utf8');
  assert.match(text, /^NEXUS_HOST=127\.0\.0\.1\s*$/m);
  assert.match(text, /NEXUS_GATEWAY_KEYS/);
  assert.match(text, /LAN/i);
  assert.match(text, /public internet/i);
  assert.match(text, /^NEXUS_GATEWAY_KEYS=\s*$/m, 'the shipped example must not contain a key value');
  assert.ok(!/^NEXUS_HOST=0\.0\.0\.0/m.test(text));
});
