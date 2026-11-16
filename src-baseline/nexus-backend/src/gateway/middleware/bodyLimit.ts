import type { IncomingMessage } from 'node:http';
import { ServerConfig } from '../../config/env.js';
import { Errors } from '../../core/errors.js';

export async function readJsonBody<T = unknown>(req: IncomingMessage, maxBytes = ServerConfig.maxBodyBytes): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > maxBytes) {
      // Dedicated resilience testing fix: this used to call req.destroy()
      // here, which tears down the WHOLE underlying socket (req and res
      // share one) — confirmed empirically that the client never receives
      // the 413 at all in that case (the connection resets first,
      // surfacing as a generic network error instead of a clean,
      // actionable "payload too large" response). Simply stopping the
      // read and throwing normally lets the router's existing
      // catch-and-respond path send a real 413 over the still-open
      // connection, which is what a caller actually needs to see.
      throw Errors.payloadTooLarge();
    }
    chunks.push(chunk as Buffer);
  }
  if (total === 0) return {} as T;
  const text = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw Errors.validation('جسم الطلب ليس JSON صالحاً.');
  }
}
