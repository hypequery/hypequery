import { CloudApiError } from './errors.js';
import {
  BASE_PATH,
  OPERATIONS,
  type CloudClientOperations,
  type CloudOperationName,
  type CloudOperationTypes,
} from './generated/operations.js';
import type { CallOptions, OperationMeta } from './types.js';
import { parseErrorEnvelope } from './utils/error-envelope.js';
import { buildRequest } from './utils/request.js';

export const DEFAULT_CLOUD_URL = 'https://cloud.hypequery.com';

export interface CloudClientOptions {
  /**
   * Bearer token: a management token (`hqmt_v1_...`) or any token Cloud
   * accepts. A function is called before every request, so a caller can
   * refresh it.
   */
  readonly token: string | (() => string | Promise<string>);
  /** Cloud's origin. Defaults to https://cloud.hypequery.com. */
  readonly baseUrl?: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Sent with every request (e.g. a `user-agent`). `authorization` is always the token. */
  readonly headers?: Readonly<Record<string, string>>;
}

/** Input for an operation; optional when the operation has no required fields. */
export type OperationInputArgs<Name extends CloudOperationName> =
  CloudOperationTypes[Name]['inputRequired'] extends true
    ? [input: CloudOperationTypes[Name]['input'], options?: CallOptions]
    : [input?: CloudOperationTypes[Name]['input'], options?: CallOptions];

export type CloudClient = CloudClientOperations & {
  /** Calls any operation by name: `client.call('drafts.list', { project })`. */
  call<Name extends CloudOperationName>(
    name: Name,
    ...args: OperationInputArgs<Name>
  ): Promise<CloudOperationTypes[Name]['output']>;
};

const REQUEST_ID_HEADER = 'x-hypequery-request-id';

function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
}

async function readBody(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await response.text();
  if (!text.trim()) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function unexpected(operation: OperationMeta, response: Response, message: string): CloudApiError {
  const status = response.status;
  return new CloudApiError({
    operation: operation.name,
    code: 'UNEXPECTED_RESPONSE',
    message,
    status,
    category: status >= 500 ? 'unavailable' : 'internal',
    retryable: status >= 500 || status === 429,
    correctable: false,
    requestId: response.headers.get(REQUEST_ID_HEADER) ?? undefined,
  });
}

/**
 * A typed client for hypequery Cloud's `/v1` operations, generated from
 * `operations-v1.json`. Every method resolves to the operation's output or
 * rejects with a `CloudApiError`.
 *
 * ```ts
 * const cloud = createCloudClient({ token: process.env.HYPEQUERY_API_TOKEN! });
 * const { projects } = await cloud.projects.list();
 * await cloud.drafts.delete({ project: 'shop', draft, confirm: true });
 * ```
 */
export function createCloudClient(options: CloudClientOptions): CloudClient {
  const baseUrl = options.baseUrl ?? DEFAULT_CLOUD_URL;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('No fetch implementation: pass `fetch` to createCloudClient.');
  }

  async function invoke(
    operation: OperationMeta,
    input: Readonly<Record<string, unknown>> = {},
    callOptions: CallOptions = {},
  ): Promise<unknown> {
    const token = typeof options.token === 'function' ? await options.token() : options.token;
    const request = buildRequest(operation, input, {
      baseUrl,
      basePath: BASE_PATH,
      token,
      headers: { ...options.headers, ...callOptions.headers },
    });

    // The body read is guarded too: fetch resolves on headers, so a dropped
    // connection can surface while the body downloads.
    let response: Response;
    let body: Awaited<ReturnType<typeof readBody>>;
    try {
      response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        ...(callOptions.signal ? { signal: callOptions.signal } : {}),
      });
      body = await readBody(response);
    } catch (error) {
      if (isAbort(error, callOptions.signal)) throw error;
      throw new CloudApiError({
        operation: operation.name,
        code: 'NETWORK_ERROR',
        message: `Couldn't reach hypequery Cloud at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
        category: 'unavailable',
        retryable: true,
        correctable: false,
        cause: error,
      });
    }

    if (response.ok) {
      if (!body.ok) throw unexpected(operation, response, `${operation.name} returned a body that isn't JSON.`);
      return body.value;
    }
    const envelope = body.ok ? parseErrorEnvelope(body.value) : undefined;
    if (!envelope) {
      throw unexpected(operation, response, `${operation.name} failed with HTTP ${response.status}.`);
    }
    throw new CloudApiError({
      operation: operation.name,
      code: envelope.code,
      message: envelope.message,
      status: response.status,
      hint: envelope.hint || undefined,
      docsUrl: envelope.docsUrl || undefined,
      category: envelope.category,
      retryable: envelope.retryable,
      correctable: envelope.correctable,
      requestId: envelope.requestId || response.headers.get(REQUEST_ID_HEADER) || undefined,
      ...(envelope.issues ? { issues: envelope.issues } : {}),
    });
  }

  const resources: Record<string, Record<string, (input?: any, options?: CallOptions) => Promise<unknown>>> = {};
  for (const operation of Object.values(OPERATIONS) as OperationMeta[]) {
    const [resource, verb] = operation.name.split('.') as [string, string];
    resources[resource] ??= {};
    resources[resource][verb] = (input, callOptions) => invoke(operation, input, callOptions);
  }

  const call = (name: string, input?: Record<string, unknown>, callOptions?: CallOptions) => {
    const operation = (OPERATIONS as Record<string, OperationMeta>)[name];
    if (!operation) return Promise.reject(new TypeError(`Unknown Cloud operation "${name}".`));
    return invoke(operation, input, callOptions);
  };

  return { ...resources, call } as unknown as CloudClient;
}
