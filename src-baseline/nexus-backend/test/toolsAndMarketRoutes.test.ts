import '../test/helpers/setMissionTestEnv.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

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

// Restoration-pass gap: this route had zero HTTP-level test coverage before
// this file, which is how a real shape mismatch went unnoticed — see below.
test('POST /api/tools/fetch rejects a missing "url" with a real validation error', async () => {
  const res = await fetch(`${nexusUrl}/api/tools/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

// Restoration-pass fix under test: this endpoint used to return 200 with a
// stub body ({available:false, currency, message}) sharing NO field names
// with what the frontend's syncMarketContext() actually reads on success
// (data.fetchedAt, data.goldPriceUsdPerOz, data.goldPriceUsdPerGram,
// data.usdToLocalRate, data.goldPriceLocalPerGram) — a 200 there meant the
// frontend would silently build "Invalid Date"/"undefined$" text and splice
// it straight into the chat context sent to the model. The frontend already
// has a correct fail-silent path for exactly this (`if(!res.ok) throw` ->
// caught -> returns ''); this only needed a real non-2xx status to reach it.
test('GET /api/market-context returns a real non-2xx (not a fake 200 stub) while the data source is unconfigured', async () => {
  const res = await fetch(`${nexusUrl}/api/market-context?currency=EGP`);
  assert.notEqual(res.status, 200, 'a 200 here is exactly the bug: the frontend has no way to distinguish it from real data');
  assert.equal(res.status, 503);
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, 'not_configured');
  // The frontend's actual consumer for this route doesn't parse the error
  // body (it only checks res.ok), but the message should still say
  // something sane for anyone hitting this endpoint directly / via curl.
  assert.match(body.error.message, /EGP/);
});
