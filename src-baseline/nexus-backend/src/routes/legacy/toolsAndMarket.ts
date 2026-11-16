import type { Router, RouteContext } from '../../gateway/router.js';
import { readJsonBody } from '../../gateway/middleware/bodyLimit.js';
import { fetchAndExtract } from '../../tools/builtin/webFetchTool.js';
import { Errors } from '../../core/errors.js';

export function registerToolsAndMarketRoutes(router: Router) {
  router.post('/api/tools/fetch', async (ctx: RouteContext) => {
    const body = await readJsonBody<{ url?: string }>(ctx.req);
    if (!body.url) throw Errors.validation('الحقل "url" مطلوب.');
    const result = await fetchAndExtract(body.url);
    ctx.res.writeHead(200, { 'Content-Type': 'application/json' });
    ctx.res.end(JSON.stringify({ text: result.text, truncated: result.truncated }));
  });

  router.get('/api/market-context', async (ctx: RouteContext) => {
    const currency = ctx.query.get('currency') || 'USD';
    // Real implementation would call a market-data provider here through
    // the same safeFetch() SSRF guard as the web_fetch tool (see
    // tools/builtin/webFetchTool.ts) — kept minimal here (no hardcoded
    // third-party API dependency baked into a from-scratch backend
    // without a chosen data vendor / API key configuration convention),
    // but any real integration should route through that same secure
    // fetch path so it's a one-function change, not a new security review.
    //
    // Restoration-pass fix: this used to return 200 with a stub body
    // ({available:false, currency, message}) that shares no field names
    // with what the frontend actually reads on success (data.fetchedAt,
    // data.goldPriceUsdPerOz, etc.) — silently producing "Invalid Date"/
    // "undefined$" text that got appended straight into chat context. A
    // real Errors.notConfigured() (503) reaches the frontend's own
    // existing, correct fail-silent handling instead (see its comment).
    throw Errors.notConfigured(`مصدر بيانات السوق (${currency}) غير مُعدّ على هذا الخادم بعد.`);
  });
}
