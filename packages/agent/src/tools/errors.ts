import type {
  HypequeryToolErrorCategory,
  HypequeryToolErrorCode,
  HypequeryToolErrorDetails,
} from './types.js';

/** The `_meta` key hypequery Cloud puts a call's request id under. */
export const REQUEST_ID_META_KEY = 'com.hypequery/requestId';

/**
 * A failure the model cannot fix: the endpoint refused the token, could not be
 * reached, or broke the protocol. Tool errors (bad input, unknown dataset,
 * timeouts) are not thrown; they come back as `{ ok: false, error }` results.
 */
export class HypequeryToolsError extends Error {
  readonly code: HypequeryToolErrorCode | (string & {});
  readonly category: HypequeryToolErrorCategory | (string & {});
  readonly retryable: boolean;
  readonly correctable: boolean;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly requestId?: string;
  /** The HTTP status, when the endpoint answered with one. */
  readonly status?: number;

  constructor(details: HypequeryToolErrorDetails, options: { status?: number; cause?: unknown } = {}) {
    super(details.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'HypequeryToolsError';
    this.code = details.code;
    this.category = details.category;
    this.retryable = details.retryable;
    this.correctable = details.correctable;
    if (details.hint !== undefined) this.hint = details.hint;
    if (details.docsUrl !== undefined) this.docsUrl = details.docsUrl;
    if (details.requestId !== undefined) this.requestId = details.requestId;
    if (options.status !== undefined) this.status = options.status;
  }

  /** The error as hypequery's envelope. */
  toJSON(): HypequeryToolErrorDetails {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      retryable: this.retryable,
      correctable: this.correctable,
      ...(this.hint === undefined ? {} : { hint: this.hint }),
      ...(this.docsUrl === undefined ? {} : { docsUrl: this.docsUrl }),
      ...(this.requestId === undefined ? {} : { requestId: this.requestId }),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read hypequery's envelope from a value, keeping only the fields it defines. */
export function readErrorEnvelope(value: unknown): HypequeryToolErrorDetails | undefined {
  if (!isRecord(value) || typeof value.code !== 'string' || typeof value.message !== 'string') {
    return undefined;
  }
  const details: HypequeryToolErrorDetails = {
    code: value.code,
    category: typeof value.category === 'string' ? value.category : 'internal',
    message: value.message,
    retryable: value.retryable === true,
    correctable: value.correctable === true,
  };
  if (typeof value.retryAfterSeconds === 'number') details.retryAfterSeconds = value.retryAfterSeconds;
  if (typeof value.relist === 'boolean') details.relist = value.relist;
  const reason = optionalString(value.reason);
  const hint = optionalString(value.hint);
  const docsUrl = optionalString(value.docsUrl);
  const requestId = optionalString(value.requestId);
  if (reason !== undefined) details.reason = reason;
  if (hint !== undefined) details.hint = hint;
  if (docsUrl !== undefined) details.docsUrl = docsUrl;
  if (requestId !== undefined) details.requestId = requestId;
  return details;
}

/** The request id from a result's `_meta`, if the server sent one. */
export function readRequestId(result: Record<string, unknown>): string | undefined {
  const meta = result._meta;
  return isRecord(meta) ? optionalString(meta[REQUEST_ID_META_KEY]) : undefined;
}

function textOf(result: Record<string, unknown>): string | undefined {
  const content = result.content;
  if (!Array.isArray(content)) return undefined;
  const texts = content
    .filter((part): part is { type: 'text'; text: string } => isRecord(part) && part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text);
  return texts.length > 0 ? texts.join('\n') : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The error envelope of an `isError` result: structured when sent, otherwise from its text. */
export function errorFromResult(result: Record<string, unknown>): HypequeryToolErrorDetails {
  const structured = isRecord(result.structuredContent)
    ? readErrorEnvelope(result.structuredContent.error)
    : undefined;
  if (structured !== undefined) return structured;

  const text = textOf(result) ?? 'Tool call failed';
  const parsed = parseJson(text);
  const fromText = isRecord(parsed) ? readErrorEnvelope(parsed.error) : undefined;
  if (fromText !== undefined) return fromText;

  // `formatMCPToolError` text: "Error [CODE]: message".
  const formatted = /^Error \[([A-Z_]+)\]: ([\s\S]*)$/.exec(text);
  return {
    code: formatted?.[1] ?? 'MCP_EXECUTION_FAILED',
    category: 'internal',
    message: formatted?.[2] ?? text,
    retryable: false,
    correctable: false,
  };
}

/** A successful result's data: `structuredContent`, else its text parsed as JSON, else the text. */
export function dataFromResult(result: Record<string, unknown>): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = textOf(result);
  if (text === undefined) return result.content ?? null;
  const parsed = parseJson(text);
  return parsed === undefined ? text : parsed;
}

function codeForStatus(status: number | undefined): Pick<HypequeryToolErrorDetails, 'code' | 'category' | 'retryable'> {
  if (status === 401 || status === 403) return { code: 'MCP_UNAUTHORIZED', category: 'unauthorized', retryable: false };
  if (status === 429) return { code: 'MCP_RATE_LIMITED', category: 'budget', retryable: true };
  return { code: 'MCP_EXECUTION_FAILED', category: 'internal', retryable: true };
}

/**
 * Turn a transport or protocol failure into a `HypequeryToolsError`. When the
 * endpoint's refusal body carries hypequery's envelope, its hint, docs link
 * and request id are kept.
 */
export function toHypequeryToolsError(error: unknown): HypequeryToolsError {
  if (error instanceof HypequeryToolsError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const rawStatus = isRecord(error) && typeof error.code === 'number' && error.name !== 'McpError'
    ? error.code
    : undefined;
  const status = rawStatus !== undefined && rawStatus >= 100 && rawStatus < 600 ? rawStatus : undefined;

  const bodyStart = message.indexOf('{');
  const body = bodyStart >= 0 ? parseJson(message.slice(bodyStart)) : undefined;
  const envelope = isRecord(body) ? readErrorEnvelope(body.error) ?? readErrorEnvelope(body) : undefined;

  const details: HypequeryToolErrorDetails = envelope ?? {
    ...codeForStatus(status),
    message,
    correctable: false,
  };
  return new HypequeryToolsError(details, { status, cause: error });
}
