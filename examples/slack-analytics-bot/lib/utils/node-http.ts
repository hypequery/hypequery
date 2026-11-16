import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

/** Same default as `createSlackRequestHandler({ maxBodyBytes })` in @hypequery/slack. */
export const DEFAULT_MAX_BODY_BYTES = 1_000_000;

/** The request body is over the limit: answer 413 and read no more of it. */
export class PayloadTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Request body is over ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Serve a Fetch API handler on `path` from a Node.js HTTP server. A body over
 * `maxBodyBytes` gets a 413 before it is buffered, a client that hangs up
 * mid-request is dropped, and any other failure is a 500. Nothing escapes as
 * an unhandled rejection, so one bad request can't take the process down.
 */
export function serveFetch(
  handler: (request: Request) => Promise<Response>,
  options: { path: string; origin: string; maxBodyBytes?: number },
): RequestListener {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  return (req, res) => {
    void (async () => {
      try {
        if (new URL(req.url ?? '/', options.origin).pathname !== options.path) return void res.writeHead(404).end();
        await send(res, await handler(await toRequest(req, options.origin, { maxBodyBytes })));
      } catch (error) {
        fail(req, res, error);
      }
    })();
  };
}

function fail(req: IncomingMessage, res: ServerResponse, error: unknown): void {
  // The client hung up: there is no one to answer.
  if (req.destroyed && !req.complete) return void res.destroy();
  // Part of the answer is already on the wire: cut it off rather than send a second one.
  if (res.headersSent) return void res.destroy();
  if (error instanceof PayloadTooLargeError) {
    // Close the connection instead of reading the rest of the body.
    return void res.writeHead(413, { 'content-type': 'text/plain', connection: 'close' }).end('Payload Too Large');
  }
  console.error('Failed to handle a Slack request:', error);
  res.writeHead(500, { 'content-type': 'text/plain' }).end('Internal Server Error');
}

/**
 * A Node.js request as a Fetch API `Request`, body included. Throws
 * `PayloadTooLargeError` as soon as the declared or received body is over
 * `maxBodyBytes`, without reading the rest.
 */
export async function toRequest(
  req: IncomingMessage,
  origin: string,
  { maxBodyBytes = DEFAULT_MAX_BODY_BYTES }: { maxBodyBytes?: number } = {},
): Promise<Request> {
  if (Number(req.headers['content-length']) > maxBodyBytes) throw new PayloadTooLargeError(maxBodyBytes);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await readBody(req, maxBodyBytes) : undefined;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (Array.isArray(value)) headers.set(key, value.join(', '));
  }
  return new Request(new URL(req.url ?? '/', origin), { method: req.method, headers, body });
}

function readBody(req: IncomingMessage, maxBodyBytes: number): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const settle = (finish: () => void) => {
      req.off('data', onData).off('end', onEnd).off('error', onError).off('close', onClose);
      finish();
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBodyBytes) return void chunks.push(chunk);
      req.pause();
      settle(() => reject(new PayloadTooLargeError(maxBodyBytes)));
    };
    const onEnd = () => settle(() => resolve(Buffer.concat(chunks)));
    const onError = (error: Error) => settle(() => reject(error));
    const onClose = () => settle(() => reject(new Error('The client closed the connection mid-request')));
    req.on('data', onData).on('end', onEnd).on('error', onError).on('close', onClose);
  });
}

/** Write a Fetch API `Response` to a Node.js response. */
export async function send(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}
