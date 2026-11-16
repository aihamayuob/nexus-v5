import '../test/helpers/setMissionTestEnv.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXUS_ENABLE_CODE_EXECUTION_TOOL = 'true';
process.env.NEXUS_CODE_EXECUTION_TIMEOUT_MS = '1500';
process.env.NEXUS_CODE_EXECUTION_MAX_OUTPUT_CHARS = '200';
process.env.NEXUS_CODE_EXECUTION_MAX_CONCURRENCY = '2';

// ServerConfig reads env vars once at import time (see setMissionTestEnv.ts's
// doc comment / test/missionTimeout.test.ts) — this file's env writes above
// MUST happen before importing sandbox.ts, hence the dynamic import below
// rather than a top-level static import.
const { Sandbox } = await import('../src/sandbox/sandbox.js');

test('Sandbox.runCode actually executes real JavaScript via a real child process and captures real stdout', async () => {
  const result = await Sandbox.runCode('javascript', "console.log('nexus-sandbox-js-' + (2+2))");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /nexus-sandbox-js-4/);
  assert.equal(result.timedOut, false);
});

test('Sandbox.runCode actually executes real Python via a real child process', async () => {
  const result = await Sandbox.runCode('python', "print('nexus-sandbox-py-' + str(3*3))");
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /nexus-sandbox-py-9/);
});

test('Sandbox.runCode captures real stderr and a non-zero real exit code on an actual runtime error', async () => {
  const result = await Sandbox.runCode('javascript', "throw new Error('boom-nexus-test')");
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /boom-nexus-test/);
});

test('Sandbox.runCode actually SIGKILLs a real infinite loop at the configured wall-clock timeout, not left hanging', async () => {
  const start = Date.now();
  const result = await Sandbox.runCode('javascript', 'while (true) {}');
  const elapsed = Date.now() - start;
  assert.equal(result.timedOut, true);
  assert.ok(elapsed < 3000, `expected the real timeout (1500ms) to bound this, took ${elapsed}ms`);
  assert.ok(elapsed >= 1400, `expected it to run for close to the real 1500ms timeout, only took ${elapsed}ms`);
});

test('Sandbox.runCode actually truncates and kills a real runaway-output script instead of letting it exhaust memory', async () => {
  const result = await Sandbox.runCode('python', "while True: print('x' * 1000)");
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 200, `expected output capped at 200 chars, got ${result.stdout.length}`);
});

test('Sandbox.runCode never leaks this process\'s real environment secrets into the child (only PATH is passed)', async () => {
  process.env.NEXUS_TEST_FAKE_SECRET = 'super-secret-value-should-never-leak';
  const result = await Sandbox.runCode('python', "import os; print('SECRET_PRESENT=' + str('NEXUS_TEST_FAKE_SECRET' in os.environ))");
  assert.match(result.stdout, /SECRET_PRESENT=False/);
  delete process.env.NEXUS_TEST_FAKE_SECRET;
});

test('Sandbox.runCode rejects an unsupported language cleanly, not a crash', async () => {
  await assert.rejects(() => Sandbox.runCode('ruby' as never, 'puts 1'), /غير مدعومة/);
});

test('two Sandbox.runCode calls run concurrently within the configured cap, in real wall-clock time (not serialized)', async () => {
  const start = Date.now();
  await Promise.all([Sandbox.runCode('python', 'import time; time.sleep(0.4)'), Sandbox.runCode('python', 'import time; time.sleep(0.4)')]);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 900, `expected two concurrent 400ms sleeps (cap=2) to overlap, took ${elapsed}ms`);
});
