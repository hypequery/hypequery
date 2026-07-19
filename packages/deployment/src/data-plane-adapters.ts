import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS,
} from '@hypequery/protocol';
import {
  DeploymentDataPlaneError,
  type DeploymentDataPlane,
  type DeploymentDataPlaneResult,
} from './data-plane.js';
import { DeploymentHostError } from './host.js';

export type DeploymentDataPlaneFetchHandler = (request: Request) => Promise<Response>;
export type DeploymentDataPlaneNodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

export interface DeploymentDataPlaneAdapterRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly headers: Readonly<Record<string, string>>;
}

export interface DeploymentDataPlaneAdapterOptions {
  /** Request body limit from 1 through 1,048,576 bytes. */
  readonly maxRequestBytes?: number;
  readonly credentials?: (request: DeploymentDataPlaneAdapterRequest) => unknown;
}

interface AdapterResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

class AdapterError extends Error {
  constructor(
    readonly code: 'HQ_DATA_PLANE_INPUT_INVALID' | 'HQ_DATA_PLANE_REQUEST_TOO_LARGE',
    readonly status: 400 | 413,
    message: string,
  ) {
    super(message);
  }
}

const JSON_CONTENT_TYPE = /^application\/json(?:;\s*charset=utf-8)?$/i;

function maximumBytes(input: number | undefined): number {
  const maximum = DEFAULT_PROTOCOL_SCHEMA_VALUE_LIMITS.maxInputBytes;
  const value = input ?? maximum;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`maxRequestBytes must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function queryParameters(search: URLSearchParams): Readonly<Record<string, string | readonly string[]>> {
  const query = Object.create(null) as Record<string, string | readonly string[]>;
  for (const [name, value] of search) {
    const current = query[name];
    if (current === undefined) query[name] = value;
    else if (typeof current === 'string') query[name] = Object.freeze([current, value]);
    else query[name] = Object.freeze([...current, value]);
  }
  return Object.freeze(query);
}

function contentLength(headers: Readonly<Record<string, string>>, maximum: number): number | undefined {
  const value = headers['content-length'];
  if (value === undefined) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Content-Length is invalid.');
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Content-Length is invalid.');
  }
  if (length > maximum) {
    throw new AdapterError(
      'HQ_DATA_PLANE_REQUEST_TOO_LARGE',
      413,
      'The data-plane request exceeds its byte limit.',
    );
  }
  return length;
}

function requestInput(
  query: Readonly<Record<string, string | readonly string[]>>,
  body: Uint8Array | undefined,
  contentType: string | undefined,
): string | Uint8Array | undefined {
  const hasQuery = Object.keys(query).length > 0;
  if (body !== undefined && hasQuery) {
    throw new AdapterError(
      'HQ_DATA_PLANE_INPUT_INVALID',
      400,
      'A data-plane request cannot contain both query parameters and a JSON body.',
    );
  }
  if (body !== undefined) {
    if (!contentType || !JSON_CONTENT_TYPE.test(contentType)) {
      throw new AdapterError(
        'HQ_DATA_PLANE_INPUT_INVALID',
        400,
        'Data-plane request bodies require application/json with UTF-8 encoding.',
      );
    }
    return body;
  }
  return hasQuery ? JSON.stringify(query) : undefined;
}

function credentials(
  options: DeploymentDataPlaneAdapterOptions,
  request: DeploymentDataPlaneAdapterRequest,
): unknown {
  return options.credentials ? options.credentials(request) : request.headers.authorization;
}

function cacheControl(result: DeploymentDataPlaneResult): string {
  if (result.cacheTtlMs === undefined || result.cacheTtlMs <= 0) return 'no-store';
  return `public, max-age=${Math.floor(result.cacheTtlMs / 1_000)}`;
}

function successResponse(result: DeploymentDataPlaneResult): AdapterResponse {
  if (result.output === undefined) {
    return Object.freeze({
      status: 204,
      headers: Object.freeze({ 'cache-control': cacheControl(result) }),
    });
  }
  const body = `${JSON.stringify(result.output)}\n`;
  return Object.freeze({
    status: 200,
    headers: Object.freeze({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': cacheControl(result),
    }),
    body,
  });
}

function errorStatus(error: DeploymentDataPlaneError): number {
  switch (error.code) {
    case 'HQ_DATA_PLANE_INPUT_INVALID': return 400;
    case 'HQ_DATA_PLANE_UNAUTHENTICATED': return 401;
    case 'HQ_DATA_PLANE_FORBIDDEN':
    case 'HQ_DATA_PLANE_TENANT_REQUIRED': return 403;
    case 'HQ_DATA_PLANE_ROUTE_NOT_FOUND': return 404;
    case 'HQ_DATA_PLANE_METHOD_NOT_ALLOWED': return 405;
    case 'HQ_DATA_PLANE_ABORTED': return 499;
    case 'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE': return 503;
    default: return 500;
  }
}

function errorResponse(error: unknown): AdapterResponse {
  let status = 500;
  let code = 'HQ_DATA_PLANE_INTERNAL';
  let message = 'The deployment data-plane request could not be processed.';
  let path: string | undefined;
  if (error instanceof AdapterError) {
    status = error.status;
    code = error.code;
    message = error.message;
  } else if (error instanceof DeploymentDataPlaneError) {
    status = errorStatus(error);
    code = error.code;
    if (status < 500) {
      message = error.message;
      path = error.path;
    }
  } else if (error instanceof DeploymentHostError) {
    code = error.code;
    if (error.code === 'HQ_DEPLOYMENT_HOST_NOT_READY'
      || error.code === 'HQ_DEPLOYMENT_HOST_CLOSED') {
      status = 503;
      message = error.message;
    }
  }
  const body = `${JSON.stringify({
    error: { code, message, ...(path === undefined ? {} : { path }) },
  })}\n`;
  return Object.freeze({
    status,
    headers: Object.freeze({
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      'cache-control': 'no-store',
      ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
    }),
    body,
  });
}

async function execute(
  dataPlane: DeploymentDataPlane,
  options: DeploymentDataPlaneAdapterOptions,
  request: DeploymentDataPlaneAdapterRequest,
  input: string | Uint8Array | undefined,
  signal: AbortSignal | undefined,
): Promise<AdapterResponse> {
  try {
    const result = await dataPlane.executeJson({
      ...request,
      input,
      credentials: credentials(options, request),
      signal,
    });
    return successResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

function fetchHeaders(input: Headers): Readonly<Record<string, string>> {
  const headers = Object.create(null) as Record<string, string>;
  for (const [name, value] of input) headers[name.toLowerCase()] = value;
  if (headers.authorization?.includes(',')) {
    throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Authorization header is ambiguous.');
  }
  return Object.freeze(headers);
}

async function fetchBytes(
  stream: ReadableStream<Uint8Array> | null,
  declared: number | undefined,
  maximum: number,
): Promise<Uint8Array | undefined> {
  if (stream === null) {
    if (declared !== undefined && declared !== 0) {
      throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Request body length is invalid.');
    }
    return undefined;
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) throw new AdapterError(
        'HQ_DATA_PLANE_REQUEST_TOO_LARGE', 413, 'The data-plane request exceeds its byte limit.',
      );
      if (declared !== undefined && total > declared) {
        throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Request body length is invalid.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (declared !== undefined && total !== declared) {
    throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Request body length is invalid.');
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.byteLength === 0 ? undefined : bytes;
}

export function createDeploymentDataPlaneFetchHandler(
  dataPlane: DeploymentDataPlane,
  options: DeploymentDataPlaneAdapterOptions = {},
): DeploymentDataPlaneFetchHandler {
  const maximum = maximumBytes(options.maxRequestBytes);
  return async request => {
    let response: AdapterResponse;
    try {
      const url = new URL(request.url);
      const headers = fetchHeaders(request.headers);
      const query = queryParameters(url.searchParams);
      const body = await fetchBytes(request.body, contentLength(headers, maximum), maximum);
      const adapted = Object.freeze({
        method: request.method.toUpperCase(), path: url.pathname, query, headers,
      });
      response = await execute(
        dataPlane,
        options,
        adapted,
        requestInput(query, body, headers['content-type']),
        request.signal,
      );
    } catch (error) {
      response = errorResponse(error);
    }
    return new Response(response.body ?? null, { status: response.status, headers: response.headers });
  };
}

function nodeHeaders(request: IncomingMessage): Readonly<Record<string, string>> {
  const headers = Object.create(null) as Record<string, string>;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]!.toLowerCase();
    const value = request.rawHeaders[index + 1]!;
    if (name === 'authorization' && headers[name] !== undefined) {
      throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Authorization header is ambiguous.');
    }
    headers[name] = headers[name] === undefined ? value : `${headers[name]}, ${value}`;
  }
  return Object.freeze(headers);
}

function nodeHasBody(headers: Readonly<Record<string, string>>): boolean {
  return headers['transfer-encoding'] !== undefined
    || headers['content-length'] !== undefined && headers['content-length'] !== '0';
}

async function nodeBytes(
  request: IncomingMessage,
  hasBody: boolean,
  declared: number | undefined,
  maximum: number,
): Promise<Uint8Array | undefined> {
  if (!hasBody) return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += bytes.byteLength;
    if (total > maximum) throw new AdapterError(
      'HQ_DATA_PLANE_REQUEST_TOO_LARGE', 413, 'The data-plane request exceeds its byte limit.',
    );
    if (declared !== undefined && total > declared) {
      throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Request body length is invalid.');
    }
    chunks.push(bytes);
  }
  if (declared !== undefined && total !== declared) {
    throw new AdapterError('HQ_DATA_PLANE_INPUT_INVALID', 400, 'Request body length is invalid.');
  }
  return total === 0 ? undefined : Buffer.concat(chunks, total);
}

function sendNodeResponse(response: ServerResponse, result: AdapterResponse): void {
  if (response.writableEnded || response.headersSent) return;
  response.statusCode = result.status;
  for (const [name, value] of Object.entries(result.headers)) response.setHeader(name, value);
  response.end(result.body);
}

export function createDeploymentDataPlaneNodeHandler(
  dataPlane: DeploymentDataPlane,
  options: DeploymentDataPlaneAdapterOptions = {},
): DeploymentDataPlaneNodeHandler {
  const maximum = maximumBytes(options.maxRequestBytes);
  return async (request, response) => {
    const abort = new AbortController();
    const onRequestClose = () => {
      if (!request.complete) abort.abort(new Error('The data-plane request was interrupted.'));
    };
    const onResponseClose = () => {
      if (!response.writableEnded) abort.abort(new Error('The data-plane response was interrupted.'));
    };
    request.once('close', onRequestClose);
    response.once('close', onResponseClose);
    try {
      const url = new URL(request.url ?? '/', 'http://deployment-data-plane.invalid');
      const headers = nodeHeaders(request);
      const query = queryParameters(url.searchParams);
      const body = await nodeBytes(
        request,
        nodeHasBody(headers),
        contentLength(headers, maximum),
        maximum,
      );
      const adapted = Object.freeze({
        method: (request.method ?? 'GET').toUpperCase(), path: url.pathname, query, headers,
      });
      sendNodeResponse(response, await execute(
        dataPlane,
        options,
        adapted,
        requestInput(query, body, headers['content-type']),
        abort.signal,
      ));
    } catch (error) {
      sendNodeResponse(response, errorResponse(error));
    } finally {
      request.off('close', onRequestClose);
      response.off('close', onResponseClose);
    }
  };
}
