/**
 * Node `http` adapter for `createMCPHttpHandler`.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { MCPHttpHandler } from './http-server.js';

export interface MCPHttpListenOptions {
  /** Port to listen on; 0 picks a free one. @default 3333 */
  port?: number;
  /** Interface to bind. @default '127.0.0.1' */
  host?: string;
}

export interface MCPHttpListener {
  /** The bound address, e.g. `http://127.0.0.1:3333`. */
  readonly url: string;
  close(): Promise<void>;
}

function toRequest(req: IncomingMessage, abort: AbortSignal): Request {
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    headers.append(req.rawHeaders[index], req.rawHeaders[index + 1]);
  }
  // The URL's own host is not trusted: the handler reads the Host header.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) as ReadableStream<Uint8Array> : undefined,
    signal: abort,
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function send(response: Response, res: ServerResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    headers[name] = value;
  });
  res.writeHead(response.status, response.statusText, headers);
  if (response.body === null) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  res.on('close', () => {
    void reader.cancel().catch(() => undefined);
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Each SSE frame goes out as it is produced.
      if (!res.write(value)) await new Promise<void>(resolve => res.once('drain', resolve));
    }
  } catch {
    // The client went away or the stream failed; nothing more to send.
  } finally {
    res.end();
  }
}

/** A `(req, res)` listener for an existing Node server, Express or Fastify raw route. */
export function createMCPNodeRequestListener(handler: MCPHttpHandler): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const abort = new AbortController();
    res.on('close', () => abort.abort());
    void (async () => {
      let response: Response;
      try {
        response = await handler.handle(toRequest(req, abort.signal));
      } catch {
        response = new Response('Internal Server Error', { status: 500 });
      }
      await send(response, res);
    })();
  };
}

/** Serve the handler on a Node HTTP server. Binds to loopback unless told otherwise. */
export async function listenMCPHttpServer(
  handler: MCPHttpHandler,
  options: MCPHttpListenOptions = {},
): Promise<MCPHttpListener> {
  const server = createServer(createMCPNodeRequestListener(handler));
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 3333, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: `http://${shown}:${address.port}`,
    async close() {
      await handler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    },
  };
}
