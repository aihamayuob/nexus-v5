import '../test/helpers/setMissionTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { openTestDb } from '../src/persistence/db.js';
import { buildRepos, resetReposSingletonForTests } from '../src/persistence/repos.js';
import { createNexusServer } from '../src/gateway/server.js';

// Restoration-pass gap: this whole route family (/api/schedules) had ZERO
// HTTP-level test coverage before this file — which is exactly how the
// PATCH-toggle gap below went unnoticed: the frontend has always sent
// `PATCH /api/schedules/:id` for its enable/disable checkbox, but Router
// never had a .patch() convenience method to register it with, so the
// route could never have existed. No LLM/provider calls are needed for any
// of these — they're pure CRUD over the schedules table.

let nexusServer: Server;
let nexusUrl: string;

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

before(async () => {
  nexusServer = createNexusServer();
  nexusUrl = await listen(nexusServer);
});

after(async () => {
  await new Promise((r) => nexusServer.close(r));
});

beforeEach(() => {
  resetReposSingletonForTests(buildRepos(openTestDb()));
});

test('POST /api/schedules creates a real schedule, GET /api/schedules lists it', async () => {
  const createRes = await fetch(`${nexusUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'لخّص أخبار السوق يومياً', provider: 'anthropic', recurrence: { type: 'daily', hour: 9, minute: 0 } }),
  });
  assert.equal(createRes.status, 200);
  const created = (await createRes.json()) as { id: string; enabled: boolean };
  assert.equal(created.enabled, true, 'a freshly created schedule must start enabled');

  const listRes = await fetch(`${nexusUrl}/api/schedules`);
  assert.equal(listRes.status, 200);
  const { schedules } = (await listRes.json()) as { schedules: Array<{ id: string }> };
  assert.ok(schedules.some((s) => s.id === created.id));
});

test('POST /api/schedules rejects a missing/invalid provider, same validation contract every other route in this file family uses', async () => {
  const res = await fetch(`${nexusUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'هدف', provider: 'not-a-real-provider', recurrence: { type: 'once', at: new Date().toISOString() } }),
  });
  assert.equal(res.status, 400);
});

// This is the fix under test: PATCH did not exist at all before this
// restoration pass (Router had no .patch(), so this route could never be
// registered) — the frontend's toggleSchedule() has always sent exactly
// this request, silently no-op-ing against a 404 with no error surfaced.
test('PATCH /api/schedules/:id toggles enabled — the exact request the frontend checkbox has always sent', async () => {
  const createRes = await fetch(`${nexusUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'جدولة للتبديل', provider: 'anthropic', recurrence: { type: 'interval', everyMs: 3600000 } }),
  });
  const { id } = (await createRes.json()) as { id: string };

  const patchRes = await fetch(`${nexusUrl}/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(patchRes.status, 200, 'PATCH must be a real, registered route — not a 404');
  const patched = (await patchRes.json()) as { id: string; enabled: boolean };
  assert.equal(patched.enabled, false);

  const listRes = await fetch(`${nexusUrl}/api/schedules`);
  const { schedules } = (await listRes.json()) as { schedules: Array<{ id: string; enabled: boolean }> };
  const persisted = schedules.find((s) => s.id === id);
  assert.equal(persisted?.enabled, false, 'the toggle must actually persist to the schedules table, not just echo the request back');

  // Toggle back on, to prove it's a real two-way switch, not one-shot.
  const patchBackRes = await fetch(`${nexusUrl}/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal((await patchBackRes.json() as { enabled: boolean }).enabled, true);
});

test('PATCH /api/schedules/:id rejects a non-boolean "enabled" field instead of silently accepting garbage', async () => {
  const createRes = await fetch(`${nexusUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'جدولة', provider: 'anthropic', recurrence: { type: 'once', at: new Date().toISOString() } }),
  });
  const { id } = (await createRes.json()) as { id: string };

  const res = await fetch(`${nexusUrl}/api/schedules/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: 'yes' }),
  });
  assert.equal(res.status, 400);
});

test('DELETE /api/schedules/:id removes it for real', async () => {
  const createRes = await fetch(`${nexusUrl}/api/schedules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'جدولة للحذف', provider: 'anthropic', recurrence: { type: 'once', at: new Date().toISOString() } }),
  });
  const { id } = (await createRes.json()) as { id: string };

  const delRes = await fetch(`${nexusUrl}/api/schedules/${id}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  const listRes = await fetch(`${nexusUrl}/api/schedules`);
  const { schedules } = (await listRes.json()) as { schedules: Array<{ id: string }> };
  assert.ok(!schedules.some((s) => s.id === id));
});
