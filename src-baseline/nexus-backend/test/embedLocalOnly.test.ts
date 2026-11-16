import './helpers/setFallbackTestEnv.js';
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createNexusServer } from '../src/gateway/server.js';

/**
 * F-UI-1 (frontend local mode) — /api/embed `localOnly` contract. The frontend's 🔒 local mode promises that nothing leaves the device/LAN, but
 * the legacy /api/embed route (unauthenticated, see authGateway.test) picked "the first embeddings-capable configured provider" — a CLOUD one (openai)
 * whenever its key exists — for text such as a user's question or a memory summary. With `localOnly:true` the route must (a) only ever choose a LOCAL
 * provider, (b) refuse an explicit non-local provider, and (c) fail closed (no cloud call of any kind) when the local embedder fails.
 * Egress is measured at the fake CLOUD server itself, never inferred from a return value.
 */

let nexus: Server;
let nexusUrl: string;
let local: Server;
let cloud: Server;
let localMode: 'ok' | 'fail503' = 'ok';
const localLog: string[] = [];
const cloudLog: string[] = [];

function listen(s: Server): Promise<string> {
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
    })
  );
}
async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

before(async () => {
  local = createServer(async (req, res) => {
    const body = await readBody(req);
    localLog.push(`${req.url}|${body}`);
    if (localMode === 'fail503') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'local embedder down' }));
    }
    const input = (JSON.parse(body).input ?? []) as string[];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ embeddings: input.map(() => [0.1, 0.2, 0.3]) }));
  });
  process.env.NEXUS_OLLAMA_BASE_URL = await listen(local);
  process.env.NEXUS_MODEL_OLLAMA = 'llama3.1';

  cloud = createServer(async (req, res) => {
    cloudLog.push(`${req.url}|${await readBody(req)}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ index: 0, embedding: [0.9, 0.8, 0.7] }] }));
  });
  process.env.NEXUS_OPENAI_BASE_URL = await listen(cloud);
  process.env.NEXUS_OPENAI_API_KEY = 'fake-openai-key'; // an embeddings-capable CLOUD provider IS configured (registry order puts it before ollama)

  nexus = createNexusServer();
  nexusUrl = await listen(nexus);
});

beforeEach(() => {
  localMode = 'ok';
  localLog.length = 0;
  cloudLog.length = 0;
});

after(async () => {
  await Promise.all([nexus, local, cloud].map((s) => new Promise((r) => s.close(r))));
});

async function embed(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${nexusUrl}/api/embed`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

test('control (unchanged legacy behaviour): WITHOUT localOnly the route still uses the first embeddings provider — the cloud one when configured', async () => {
  const r = await embed({ texts: ['legacy-control-text-1'] });
  assert.equal(r.status, 200);
  assert.equal(cloudLog.length, 1, 'harness control: the cloud embeddings meter must be live');
});

test('localOnly:true selects a LOCAL embeddings provider and sends NOTHING to the cloud', async () => {
  const r = await embed({ texts: ['localonly-secret-text-2'], localOnly: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.embeddings, [[0.1, 0.2, 0.3]]);
  assert.equal(cloudLog.length, 0, 'no request may reach the cloud embeddings provider');
  assert.ok(localLog.length >= 1, 'the local embedder served the request');
});

test('localOnly:true + an explicit CLOUD provider is refused (capability_denied) and nothing reaches the cloud', async () => {
  const r = await embed({ texts: ['localonly-secret-text-3'], localOnly: true, provider: 'openai' });
  assert.ok(r.status >= 400 && r.status < 500, `expected a 4xx refusal, got ${r.status}`);
  assert.equal(cloudLog.length, 0);
});

test('localOnly:true + an explicit LOCAL provider is honoured', async () => {
  const r = await embed({ texts: ['localonly-secret-text-4'], localOnly: true, provider: 'ollama' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(cloudLog.length, 0);
});

test('localOnly:true + the local embedder FAILING fails closed: an error status and ZERO cloud requests (no fallback)', async () => {
  localMode = 'fail503';
  const r = await embed({ texts: ['localonly-secret-text-5'], localOnly: true });
  assert.ok(r.status >= 400, `must not report success, got ${r.status}`);
  assert.equal(cloudLog.length, 0, 'a failed local embedder must never fall back to the cloud');
});

test('a non-boolean localOnly is rejected (validation) instead of being silently treated as false', async () => {
  const r = await embed({ texts: ['localonly-secret-text-6'], localOnly: 'yes' });
  assert.equal(r.status, 400);
  assert.equal(cloudLog.length, 0);
});
