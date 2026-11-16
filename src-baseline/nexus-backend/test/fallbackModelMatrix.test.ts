// ADOPTED 2026-11-16 from the R3 owner-review package (evidence/reviewer-scratch-tests/fallback-matrix.test.ts, reviewer-authored) as a permanent regression test: wire-level model placement for all 6 adapters + every cloud-primary -> fallback pair (simulated providers).
import './helpers/setFallbackTestEnv.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderRegistry, type ProviderId } from '../src/config/providerRegistry.js';
import { createProviderAdapter, clearAdapterCacheForTests, setAdapterForTests } from '../src/providers/index.js';
import { createNexusServer } from '../src/gateway/server.js';
import { Errors } from '../src/core/errors.js';
import { getRepos } from '../src/persistence/repos.js';
import type { Server } from 'node:http';

const ALL: ProviderId[] = ['anthropic','openai','deepseek','gemini','ollama','lmstudio'];
for (const id of ALL) {
  const U = id.toUpperCase();
  process.env[`NEXUS_MODEL_${U}`] = `model-of-${id}`;
  if (ProviderRegistry.resolve(id).capabilities.requiresApiKey) process.env[`NEXUS_${U}_API_KEY`] = `k-${id}`;
}
// 1) WIRE LEVEL: each real adapter, given model X, puts X where its vendor expects it.
test('wire: every adapter puts req.model in the vendor-specific location', async () => {
  const out: Record<string,string> = {};
  for (const id of ALL) {
    let seen = '';
    const fakeFetch = (async (url: any, init: any) => {
      const body = init?.body ? JSON.parse(init.body) : {};
      seen = `url=${String(url)} bodyModel=${body.model ?? '-'}`;
      throw new Error('stop-after-capture');
    }) as any;
    const a = createProviderAdapter(id, fakeFetch);
    await a.chat({ model: `WIRE-${id}`, messages: [{ role: 'user', content: 'x' }], maxTokens: 5 } as any).catch(() => {});
    out[id] = seen;
    assert.ok(seen.includes(`WIRE-${id}`), `${id}: model not on the wire -> ${seen}`);
  }
  console.log('WIRE', JSON.stringify(out, null, 1));
});

// 2) END-TO-END chatService via HTTP: for every cloud primary P and every other provider F (as the ONLY other configured one), P fails -> F must get model-of-F.
test('matrix: fallback attempt always receives the fallback provider\'s own model (all ordered pairs)', async () => {
  const pairs: string[] = [];
  const keysBackup: Record<string,string|undefined> = {};
  const server: Server = createNexusServer();
  const url: string = await new Promise((r) => server.listen(0,'127.0.0.1',() => r(`http://127.0.0.1:${(server.address() as any).port}`)));
  try {
    for (const P of ALL.filter(p => ProviderRegistry.resolve(p).capabilities.requiresApiKey)) {
      for (const F of ALL) {
        if (F === P) continue;
        // only P and F are "configured": clear other cloud keys, and other local models
        for (const id of ALL) {
          const U = id.toUpperCase();
          const keep = id === P || id === F;
          if (ProviderRegistry.resolve(id).capabilities.requiresApiKey) { keysBackup[id] ??= process.env[`NEXUS_${U}_API_KEY`]; if (keep) process.env[`NEXUS_${U}_API_KEY`] = `k-${id}`; else delete process.env[`NEXUS_${U}_API_KEY`]; }
          else { keysBackup['m'+id] ??= process.env[`NEXUS_MODEL_${U}`]; if (keep) process.env[`NEXUS_MODEL_${U}`] = `model-of-${id}`; else delete process.env[`NEXUS_MODEL_${U}`]; }
        }
        clearAdapterCacheForTests();
        const got: Record<string,string[]> = {};
        for (const id of ALL) setAdapterForTests(id, {
          id, supportsEmbeddings: false,
          async chat(req: any) { (got[id] ??= []).push(req.model); if (id === P) throw Errors.provider('boom', true); return { content: [{ type:'text', text:'ok-'+id }], stopReason:'end_turn', usage:{inputTokens:1,outputTokens:1} } as any; },
          async chatStream(req: any) { return this.chat(req); },
        } as any);
        const res = await fetch(`${url}/api/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ provider: P, model: `EXPLICIT-for-${P}`, max_tokens: 5, messages:[{role:'user',content:'m '+Math.random()}] }) });
        assert.equal(res.status, 200, `${P}->${F}: status ${res.status}`);
        assert.deepEqual(got[P], [`EXPLICIT-for-${P}`], `${P}: primary should get the explicit model`);
        assert.deepEqual(got[F], [`model-of-${F}`], `${P}->${F}: fallback must get its own model, got ${JSON.stringify(got[F])}`);
        const t = getRepos().tasks.recent(1)[0];
        assert.equal(t.provider, F); assert.equal(t.model, `model-of-${F}`);
        pairs.push(`${P}->${F}`);
      }
    }
  } finally { await new Promise((r) => server.close(r)); }
  console.log('PAIRS_OK', pairs.length, pairs.join(' '));
});
