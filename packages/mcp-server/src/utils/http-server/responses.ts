/** Small, fixed HTTP responses for the transport's own refusals. */

export function plainResponse(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

/** A JSON-RPC error with no request id, as the Streamable HTTP transport answers refusals. */
export function jsonRpcErrorResponse(status: number, code: number, message: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

export function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}

export class BodyTooLargeError extends Error {}

/** Read a request body as UTF-8 text, refusing it once it passes `maxBytes`. */
export async function readBoundedBody(request: Request, maxBytes: number): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > maxBytes) throw new BodyTooLargeError();
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

/**
 * Pass a response body through unchanged and report once it ends, whether it
 * finished, failed, or the client went away.
 */
export function onBodyEnd(response: Response, done: () => void): Response {
  if (response.body === null) {
    done();
    return response;
  }
  let finished = false;
  const finish = () => {
    if (!finished) {
      finished = true;
      done();
    }
  };
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: ended, value } = await reader.read();
        if (ended) {
          finish();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
