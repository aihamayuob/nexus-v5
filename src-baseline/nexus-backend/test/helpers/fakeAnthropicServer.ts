import { createServer, type Server } from 'node:http';

export interface FakeAnthropicOptions {
  /** Called for every request; return a canned response. */
  respond?: (body: { messages: Array<{ role: string; content: unknown }>; system?: string; stream?: boolean }) => {
    text?: string;
    toolUse?: { id: string; name: string; input: Record<string, unknown> };
    stopReason?: string;
  };
}

export function startFakeAnthropicServer(opts: FakeAnthropicOptions = {}): Promise<{ server: Server; url: string; requestLog: unknown[] }> {
  const requestLog: unknown[] = [];
  const respond: NonNullable<FakeAnthropicOptions['respond']> =
    opts.respond ?? (() => ({ text: 'fake reply', stopReason: 'end_turn' }));

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}');
    requestLog.push(body);

    if (req.url !== '/v1/messages') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    if (!req.headers['x-api-key']) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'missing api key' } }));
      return;
    }

    const result = respond(body);
    const content: unknown[] = [];
    if (result.text) content.push({ type: 'text', text: result.text });
    if (result.toolUse) content.push({ type: 'tool_use', ...result.toolUse });

    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', { type: 'message_start', message: { usage: { input_tokens: 12 } } });
      if (result.text) {
        send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } });
        for (const word of result.text.split(' ')) {
          send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: word + ' ' } });
        }
        send('content_block_stop', { type: 'content_block_stop', index: 0 });
      }
      if (result.toolUse) {
        send('content_block_start', {
          type: 'content_block_start',
          index: result.text ? 1 : 0,
          content_block: { type: 'tool_use', id: result.toolUse.id, name: result.toolUse.name },
        });
        send('content_block_delta', {
          type: 'content_block_delta',
          index: result.text ? 1 : 0,
          delta: { type: 'input_json_delta', partial_json: JSON.stringify(result.toolUse.input) },
        });
        send('content_block_stop', { type: 'content_block_stop', index: result.text ? 1 : 0 });
      }
      send('message_delta', { type: 'message_delta', delta: { stop_reason: result.stopReason || 'end_turn' }, usage: { output_tokens: 8 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ content, stop_reason: result.stopReason || 'end_turn', usage: { input_tokens: 12, output_tokens: 8 } })
      );
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}`, requestLog });
    });
  });
}
