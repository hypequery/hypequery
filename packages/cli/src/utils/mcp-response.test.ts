import { describe, expect, it, vi } from 'vitest';
import { readMcpResponse } from './mcp-response.js';

const message = { jsonrpc: '2.0', id: 1, result: { serverInfo: { name: 'café' } } };

describe('MCP responses', () => {
  it('reads a matching JSON response', async () => {
    expect(await readMcpResponse(Response.json(message), 1)).toEqual(message);
    expect(await readMcpResponse(Response.json(message), 2)).toBeNull();
  });

  it('reads fragmented SSE, skips notifications and unrelated responses, and cancels after the result', async () => {
    const text = ': keepalive\r\n\r\n'
      + 'data: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\n'
      + 'data: {"jsonrpc":"2.0","id":2,"result":{}}\r\n\r\n'
      + 'event: message\r\nid: event-1\r\n'
      + 'data: {"jsonrpc":"2.0","id":1,\r\n'
      + 'data: "result":{"serverInfo":{"name":"café"}}}\r\n\r\n';
    const bytes = new TextEncoder().encode(text);
    let offset = 0;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
        // Stay open after delivering the response, as a server may do.
      },
      cancel,
    });

    expect(await readMcpResponse(new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    }), 1)).toEqual(message);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each(['\n', '\r', '\r\n'])('handles SSE line endings %j', async newline => {
    const response = new Response(`data: ${JSON.stringify(message)}${newline}${newline}`, {
      headers: { 'content-type': 'text/event-stream' },
    });
    expect(await readMcpResponse(response, 1)).toEqual(message);
  });

  it('returns no result if an SSE stream ends without a matching response', async () => {
    expect(await readMcpResponse(new Response('data: {"id":2}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }), 1)).toBeNull();
  });

  it('does not try to read a body for an initialized notification', async () => {
    expect(await readMcpResponse(new Response(null, { status: 202 }), undefined)).toBeNull();
  });
});
