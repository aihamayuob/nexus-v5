import type { ServerResponse } from 'node:http';

/**
 * Standard SSE framing: `event: <name>\ndata: <json>\nid: <n>\n\n`.
 * This exact wire format was reverse-engineered from the frontend's own
 * parseOneSSEFrame()/parseSSEBrowser() — field order doesn't matter to
 * that parser, but the blank-line frame terminator and the `data:`/`event:`/
 * `id:` field names must match exactly, which they do here.
 */
export class SseWriter {
  private res: ServerResponse;
  private seq = 0;
  private closed = false;

  constructor(res: ServerResponse, startSeq = 0) {
    this.res = res;
    this.seq = startSeq;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering if ever fronted by one
    });
  }

  send(event: string, data: unknown, explicitId?: number): number {
    if (this.closed) return this.seq;
    const id = explicitId ?? ++this.seq;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\nid: ${id}\n\n`;
    this.res.write(payload);
    return id;
  }

  /** SSE comment line — used as a keep-alive ping that parseOneSSEFrame() correctly ignores (lines starting with ':'). */
  ping() {
    if (this.closed) return;
    this.res.write(`: ping ${Date.now()}\n\n`);
  }

  end() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.res.end();
    } catch {
      /* connection already gone */
    }
  }

  get isClosed() {
    return this.closed;
  }
}

/** Keeps a connection alive with periodic pings; caller must clearInterval on close. */
export function startKeepAlive(writer: SseWriter, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(() => writer.ping(), intervalMs);
}
