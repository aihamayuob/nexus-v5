import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { getRepos } from '../../persistence/repos.js';
import { Errors } from '../../core/errors.js';
import { createHash } from 'node:crypto';

/**
 * Sync records are scoped per authenticated "owner" — derived from the
 * gateway key itself (or the client IP in trusted/no-auth mode) so
 * different callers don't collide on one shared record. The server NEVER
 * sees plaintext: only ciphertext/iv/salt, exactly as the frontend's
 * client-side AES-GCM encryption already assumes (see pushSync()/
 * decryptSyncRecord() — this backend is intentionally unable to read
 * synced content even in principle).
 */
function ownerKeyFor(gw: { clientKey: string; ownerKey?: string }): string {
  // Keyed requests carry ownerKey = sha256(raw key) (same value this route always stored under);
  // trusted mode falls back to sha256(client IP) exactly as before.
  return gw.ownerKey ?? createHash('sha256').update(gw.clientKey).digest('hex');
}

export function registerSyncRoutes(router: Router) {
  router.put('/api/sync', async (ctx: RouteContext) => {
    const body = await readJsonBody<{
      baseVersion?: number;
      deviceId?: string;
      saltB64?: string;
      ivB64?: string;
      ciphertextB64?: string;
    }>(ctx.req);
    if (!body.deviceId || !body.saltB64 || !body.ivB64 || !body.ciphertextB64) {
      throw Errors.validation('الحقول deviceId وsaltB64 وivB64 وciphertextB64 مطلوبة.');
    }
    const ownerKey = ownerKeyFor(ctx.gw);
    const result = getRepos().sync.put(ownerKey, body.baseVersion ?? 0, body.deviceId, body.saltB64, body.ivB64, body.ciphertextB64);
    if (result === 'conflict') {
      const current = getRepos().sync.get(ownerKey)!;
      ctx.res.writeHead(409, { 'Content-Type': 'application/json' });
      ctx.res.end(JSON.stringify({ current }));
      return;
    }
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(result));
  });

  router.get('/api/sync', async (ctx: RouteContext) => {
    const ownerKey = ownerKeyFor(ctx.gw);
    const record = getRepos().sync.get(ownerKey);
    if (!record) throw Errors.notFound('لا توجد نسخة مزامنة بعد.');
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify(record));
  });

  router.delete('/api/sync', async (ctx: RouteContext) => {
    getRepos().sync.remove(ownerKeyFor(ctx.gw));
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ deleted: true }));
  });
}
