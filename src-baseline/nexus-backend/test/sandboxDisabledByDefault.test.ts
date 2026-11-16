import '../test/helpers/setMissionTestEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Deliberately does NOT set NEXUS_ENABLE_CODE_EXECUTION_TOOL — this file's
// entire purpose is to verify the real, un-overridden default. Runs in its
// own subprocess (node --test's one-file-per-process model — see
// missionTimeout.test.ts's helper split for the same reasoning), so no
// other test file's override of this flag can leak in here.
const { Sandbox } = await import('../src/sandbox/sandbox.js');
const { ServerConfig } = await import('../src/config/env.js');

test('ServerConfig.codeExecutionEnabled genuinely defaults to false with zero configuration', () => {
  assert.equal(ServerConfig.codeExecutionEnabled, false);
});

test('Sandbox.runCode is fail-closed by real default — throws capability_denied without ever spawning a process', async () => {
  await assert.rejects(() => Sandbox.runCode('javascript', "console.log('should never run')"), /معطّل/);
});
