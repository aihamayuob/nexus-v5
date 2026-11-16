import { safeFetch } from '../../security/ssrfGuard.js';
import { Errors } from '../../core/errors.js';
import { ServerConfig } from '../../config/env.js';
import type { RegisteredTool } from '../registry.js';

/**
 * Very small, dependency-free HTML-to-text stripper — good enough to feed
 * a model readable article text without pulling in a full HTML parser.
 * Not used for anything security-sensitive (SSRF protection happens in
 * safeFetch() before this ever runs).
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

export interface FetchAndExtractResult {
  text: string;
  truncated: boolean;
  finalUrl: string;
}

/**
 * Shared core used by BOTH the tool-pipeline execute() below (formats a
 * plain string for a model's tool_result) AND the legacy /api/tools/fetch
 * route (returns {text, truncated} JSON directly, matching the exact
 * shape the frontend's executeLocalTool() already expects) — one fetch
 * implementation, two output shapes, instead of duplicating the SSRF-safe
 * fetch + HTML-stripping logic in two places.
 */
export async function fetchAndExtract(url: string): Promise<FetchAndExtractResult> {
  if (!url) throw Errors.toolValidation('الرابط مفقود.');
  const result = await safeFetch(url, { timeoutMs: ServerConfig.webFetchTimeoutMs });
  if (result.status >= 400) throw Errors.provider(`فشل جلب الرابط: HTTP ${result.status}`, false);
  const isHtml = (result.headers['content-type'] || '').includes('html');
  const text = isHtml ? stripHtml(result.bodyText) : result.bodyText;
  const truncated = text.length > ServerConfig.webFetchMaxChars;
  const finalText = truncated ? text.slice(0, ServerConfig.webFetchMaxChars) : text;
  return { text: finalText, truncated, finalUrl: result.finalUrl };
}

export const webFetchTool: RegisteredTool = {
  def: {
    name: 'web_fetch',
    description: 'اجلب محتوى صفحة ويب حقيقية بعنوانها (URL) واقرأ نصها.',
    input_schema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'الرابط الكامل، مثلاً https://example.com/article' } },
      required: ['url'],
    },
  },
  timeoutMs: ServerConfig.webFetchTimeoutMs,
  effectClass: {
    kind: 'read_only',
    reason: 'طلب HTTP GET فقط عبر safeFetch (حارس SSRF)؛ لا مسار كتابة مقصود. أثر GET الجانبي على خادم بعيد لا نتحكم به غير مغطّى.',
  },
  async execute(input) {
    const { text, truncated } = await fetchAndExtract(String(input.url ?? ''));
    return (truncated ? '[تنبيه: المحتوى طويل وتم اقتطاعه]\n' : '') + text;
  },
};
