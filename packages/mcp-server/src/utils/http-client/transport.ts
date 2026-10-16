import { MCPExecutionBudgetError, MCPToolError } from '../../errors.js';

export type BackendHeaders = Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
export interface HttpBackend {
  readonly discovery: URL;
  readonly headers?: BackendHeaders;
  readonly fetchFn: typeof fetch;
}

export function backendUrl(input: string): URL {
  try {
    const url = new URL(input);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)
      || url.username || url.password || url.hash || url.search) throw new Error();
    return url;
  } catch { throw new Error('Use an HTTPS discovery URL (HTTP is allowed only on loopback), without credentials, query or fragment.'); }
}

export async function backendRequest(
  backend: HttpBackend, url: URL, signal: AbortSignal, body?: Readonly<Record<string, unknown>>, schemaHash?: string,
): Promise<Response> {
  if (url.origin !== backend.discovery.origin) throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend origin changed.', { retryable: false });
  try {
    signal.throwIfAborted();
    const configured = typeof backend.headers === 'function' ? await backend.headers() : backend.headers;
    const headers = new Headers(configured);
    headers.set('accept', 'application/json');
    if (body) headers.set('content-type', 'application/json');
    if (schemaHash) headers.set('x-hypequery-client-schema', schemaHash);
    signal.throwIfAborted();
    return await backend.fetchFn(url.href, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual', credentials: 'omit', cache: 'no-store', signal,
    });
  } catch {
    if (signal.aborted) throw signal.reason;
    throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend request failed.', { retryable: true });
  }
}

export function discardBackendBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/** Bound decompressed streamed bytes, including when Content-Length is absent or dishonest. */
export async function backendText(response: Response, maximum: number, signal: AbortSignal): Promise<string> {
  const length = response.headers.get('content-length');
  const type = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type ?? '')) {
    discardBackendBody(response);
    throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend did not return JSON.', { retryable: false });
  }
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    discardBackendBody(response);
    throw new MCPExecutionBudgetError('MCP_RESULT_TOO_LARGE', 'Backend response exceeds its byte limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend returned no response body.', { retryable: false });
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    signal.throwIfAborted();
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw new MCPExecutionBudgetError('MCP_RESULT_TOO_LARGE', 'Backend response exceeds its byte limit.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    cancel();
    if (signal.aborted) throw signal.reason;
    if (error instanceof MCPExecutionBudgetError) throw error;
    throw new MCPToolError('MCP_EXECUTION_FAILED', 'Backend response could not be read.', { retryable: false });
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}
