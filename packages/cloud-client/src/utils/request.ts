import type { OperationMeta } from '../types.js';

export interface BuiltRequest {
  readonly url: string;
  readonly method: OperationMeta['method'];
  readonly headers: Record<string, string>;
  readonly body?: string;
}

export interface RequestContext {
  readonly baseUrl: string;
  readonly basePath: string;
  readonly token: string;
  readonly headers?: Readonly<Record<string, string>>;
}

function pathValue(operation: OperationMeta, name: string, value: unknown): string {
  if ((typeof value === 'string' && value.length > 0) || typeof value === 'number') {
    return encodeURIComponent(String(value));
  }
  throw new TypeError(`${operation.name}: "${name}" is required (it's part of the path).`);
}

function queryValue(operation: OperationMeta, name: string, value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new TypeError(
    `${operation.name}: "${name}" can't be sent in a query string (only strings, numbers and booleans can).`,
  );
}

/**
 * The HTTP request for one operation call, matching Cloud's `/v1` handler:
 * path parameters come out of the input, GET and DELETE send the rest as the
 * query string, every other method as a JSON body.
 */
export function buildRequest(
  operation: OperationMeta,
  input: Readonly<Record<string, unknown>>,
  context: RequestContext,
): BuiltRequest {
  const pathParams = new Set(operation.pathParams);
  const path = operation.path.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) =>
    pathValue(operation, name, input[name]),
  );
  const rest = Object.entries(input).filter(
    ([name, value]) => !pathParams.has(name) && value !== undefined,
  );

  const url = new URL(`${context.baseUrl.replace(/\/+$/, '')}${context.basePath}${path}`);
  const headers: Record<string, string> = {
    accept: 'application/json',
    // Lower-cased so a caller's `Authorization` can't sit beside the token.
    ...Object.fromEntries(
      Object.entries(context.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    ),
    authorization: `Bearer ${context.token}`,
  };

  if (operation.method === 'GET' || operation.method === 'DELETE') {
    for (const [name, value] of rest) url.searchParams.set(name, queryValue(operation, name, value));
    return { url: url.toString(), method: operation.method, headers };
  }
  headers['content-type'] = 'application/json';
  return {
    url: url.toString(),
    method: operation.method,
    headers,
    body: JSON.stringify(Object.fromEntries(rest)),
  };
}
