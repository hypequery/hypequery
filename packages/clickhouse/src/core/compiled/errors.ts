/**
 * Public execution-failure envelope from RFC 0010 §Error envelope.
 *
 * The category set is closed and stable within version 1. It matches the frozen set in
 * `@hypequery/protocol` (`events` module) so runtime failures and emitted diagnostics
 * speak the same vocabulary. New categories require a new contract version.
 */
export const COMPILED_ERROR_CATEGORIES = [
  'input-invalid',
  'unauthenticated',
  'forbidden',
  'tenant-required',
  'not-found',
  'too-large',
  'aborted',
  'deadline-exceeded',
  'unavailable',
  'internal',
] as const;

export type CompiledErrorCategory = (typeof COMPILED_ERROR_CATEGORIES)[number];

/**
 * Categories that describe a client-supplied fault. Their messages MAY carry a safe,
 * caller-facing explanation. Every other category is a server/dependency fault whose
 * message MUST NOT expose adapter error text, SQL, values, or tenant identifiers.
 */
const CLIENT_FAULT_CATEGORIES: ReadonlySet<CompiledErrorCategory> = new Set([
  'input-invalid',
  'unauthenticated',
  'forbidden',
  'tenant-required',
  'not-found',
  'too-large',
  'aborted',
  'deadline-exceeded',
]);

const SAFE_MESSAGE_PATTERN = /[\r\n\t]/;

export function isCompiledErrorCategory(value: unknown): value is CompiledErrorCategory {
  return (
    typeof value === 'string' &&
    (COMPILED_ERROR_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isClientFaultCategory(category: CompiledErrorCategory): boolean {
  return CLIENT_FAULT_CATEGORIES.has(category);
}

/** The stable, serializable error object surfaced to callers. */
export interface CompiledErrorEnvelope {
  readonly category: CompiledErrorCategory;
  readonly message: string;
  /** Authoritative query identifier; safe for logs. Absent only before one is assigned. */
  readonly queryId?: string;
}

export interface CompiledQueryErrorOptions {
  readonly queryId?: string;
  /** Non-public cause retained for local logging; never serialized into the envelope. */
  readonly cause?: unknown;
}

/**
 * The only execution-failure shape a runtime may surface for a compiled query. For
 * server-fault categories the caller-facing message is fixed to a generic string so no
 * adapter text, SQL, value, or tenant identifier can leak.
 */
export class CompiledQueryError extends Error {
  readonly category: CompiledErrorCategory;
  readonly queryId?: string;
  override readonly cause?: unknown;

  constructor(
    category: CompiledErrorCategory,
    message: string,
    options: CompiledQueryErrorOptions = {}
  ) {
    const safeMessage = CompiledQueryError.resolveMessage(category, message);
    super(safeMessage);
    this.name = 'CompiledQueryError';
    this.category = category;
    this.queryId = options.queryId;
    this.cause = options.cause;
  }

  private static resolveMessage(category: CompiledErrorCategory, message: string): string {
    if (!isClientFaultCategory(category)) {
      // Server-fault categories never carry a caller-authored message.
      return DEFAULT_SERVER_FAULT_MESSAGE[category] ?? 'The request could not be completed.';
    }
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (trimmed.length === 0 || SAFE_MESSAGE_PATTERN.test(trimmed)) {
      return DEFAULT_CLIENT_FAULT_MESSAGE[category] ?? 'The request was rejected.';
    }
    return trimmed;
  }

  /** The redacted, serializable envelope. Only closed fields; no `cause`, no stack. */
  toEnvelope(): CompiledErrorEnvelope {
    return this.queryId === undefined
      ? { category: this.category, message: this.message }
      : { category: this.category, message: this.message, queryId: this.queryId };
  }
}

const DEFAULT_CLIENT_FAULT_MESSAGE: Partial<Record<CompiledErrorCategory, string>> = {
  'input-invalid': 'The request parameters were invalid.',
  unauthenticated: 'Authentication is required.',
  forbidden: 'Access is denied.',
  'tenant-required': 'A tenant context is required.',
  'not-found': 'The requested resource was not found.',
  'too-large': 'The request or result exceeded an allowed bound.',
  aborted: 'The request was cancelled.',
  'deadline-exceeded': 'The request deadline was exceeded.',
};

const DEFAULT_SERVER_FAULT_MESSAGE: Partial<Record<CompiledErrorCategory, string>> = {
  unavailable: 'The executor is temporarily unavailable.',
  internal: 'The request could not be completed.',
};
