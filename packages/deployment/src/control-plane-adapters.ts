import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  DeploymentControlPlane,
  DeploymentControlPlaneRequest,
  DeploymentControlPlaneResponse,
} from './control-plane.js';

export type DeploymentControlPlaneFetchHandler = (request: Request) => Promise<Response>;
export type DeploymentControlPlaneNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

type ControlPlaneQuery = NonNullable<DeploymentControlPlaneRequest['query']>;

const INTERNAL_BODY = '{"error":{"code":"HQ_CONTROL_INTERNAL","message":"The deployment control-plane request could not be processed."}}\n';
const INTERNAL_RESPONSE: DeploymentControlPlaneResponse = Object.freeze({
  status: 500,
  headers: Object.freeze({
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(INTERNAL_BODY)),
    'cache-control': 'no-store',
  }),
  body: INTERNAL_BODY,
});
const FETCH_SINGLETON_HEADERS = new Set([
  'authorization',
  'content-length',
  'content-type',
  'idempotency-key',
  'x-hypequery-bundle-identity',
  'x-hypequery-release-identity',
]);

function queryParameters(search: URLSearchParams): ControlPlaneQuery {
  const query = Object.create(null) as Record<string, string | readonly string[]>;
  for (const [name, value] of search) {
    const current = query[name];
    if (current === undefined) {
      query[name] = value;
    } else if (typeof current === 'string') {
      query[name] = Object.freeze([current, value]);
    } else {
      query[name] = Object.freeze([...current, value]);
    }
  }
  return Object.freeze(query);
}

function fetchHeaders(input: Headers): Readonly<Record<string, string>> {
  const headers = Object.create(null) as Record<string, string>;
  for (const [name, value] of input.entries()) {
    headers[name] = value;
    if (FETCH_SINGLETON_HEADERS.has(name) && value.includes(',')) {
      // Fetch combines duplicate header lines before exposing Headers. Reify a
      // second case-insensitive entry so the core singleton guard rejects it.
      headers[name.toUpperCase()] = value;
    }
  }
  return Object.freeze(headers);
}

async function* fetchBody(input: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  if (input === null) return;
  const reader = input.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function nodeHeaders(request: IncomingMessage): Readonly<Record<string, string>> {
  const headers = Object.create(null) as Record<string, string>;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]!.toLowerCase();
    const value = request.rawHeaders[index + 1]!;
    if (headers[name] === undefined) {
      headers[name] = value;
    } else {
      // Keep a second case-insensitive entry so the core duplicate-header guard
      // observes duplicates instead of accepting Node's comma-joined value.
      headers[name.toUpperCase()] = value;
    }
  }
  return Object.freeze(headers);
}

async function* nodeBody(request: IncomingMessage): AsyncGenerator<Uint8Array> {
  for await (const chunk of request) {
    yield chunk instanceof Uint8Array ? chunk : Buffer.from(chunk as string);
  }
}

function nodeHasBody(headers: Readonly<Record<string, string>>): boolean {
  return Object.entries(headers).some(([name, value]) => {
    const normalized = name.toLowerCase();
    return normalized === 'transfer-encoding'
      || (normalized === 'content-length' && value !== '0');
  });
}

function internalFetchResponse(): Response {
  return new Response(INTERNAL_RESPONSE.body, {
    status: INTERNAL_RESPONSE.status,
    headers: INTERNAL_RESPONSE.headers,
  });
}

function sendNodeResponse(
  response: ServerResponse,
  controlResponse: DeploymentControlPlaneResponse,
): void {
  if (response.writableEnded || response.headersSent) return;
  response.statusCode = controlResponse.status;
  for (const [name, value] of Object.entries(controlResponse.headers)) {
    response.setHeader(name, value);
  }
  response.end(controlResponse.body);
}

export function createDeploymentControlPlaneFetchHandler(
  controlPlane: DeploymentControlPlane,
): DeploymentControlPlaneFetchHandler {
  return async request => {
    try {
      const url = new URL(request.url);
      const response = await controlPlane.handle({
        method: request.method,
        path: url.pathname,
        query: queryParameters(url.searchParams),
        headers: fetchHeaders(request.headers),
        body: fetchBody(request.body),
        hasBody: request.body !== null,
        signal: request.signal,
      });
      return new Response(response.body, { status: response.status, headers: response.headers });
    } catch {
      return internalFetchResponse();
    }
  };
}

export function createDeploymentControlPlaneNodeHandler(
  controlPlane: DeploymentControlPlane,
): DeploymentControlPlaneNodeHandler {
  return async (request, response) => {
    const abort = new AbortController();
    const abortRequest = () => {
      if (!request.complete) abort.abort(new Error('The request connection was closed.'));
    };
    const abortResponse = () => {
      if (!response.writableEnded) abort.abort(new Error('The response connection was closed.'));
    };
    request.socket.once('close', abortRequest);
    response.once('close', abortResponse);
    if (request.destroyed && !request.complete) abortRequest();
    try {
      const url = new URL(request.url ?? '/', 'http://deployment-control-plane.invalid');
      const headers = nodeHeaders(request);
      const controlResponse = await controlPlane.handle({
        method: request.method ?? 'GET',
        path: url.pathname,
        query: queryParameters(url.searchParams),
        headers,
        body: nodeBody(request),
        hasBody: nodeHasBody(headers),
        signal: abort.signal,
      });
      sendNodeResponse(response, controlResponse);
    } catch {
      sendNodeResponse(response, INTERNAL_RESPONSE);
    } finally {
      request.socket.off('close', abortRequest);
      response.off('close', abortResponse);
    }
  };
}
