import type { CloudErrorCategory, CloudErrorCode } from './generated/operations.js';

/** Codes the client itself raises when there's no Cloud error envelope to read. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';

/** One invalid input field, from an `INVALID_INPUT` error. */
export interface CloudInputIssue {
  /** Dotted path to the field, or `(root)`. */
  readonly path: string;
  readonly message: string;
}

/** The `error` object of Cloud's error envelope `{ error: { ... } }`. */
export interface CloudErrorBody {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly docsUrl: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly correctable: boolean;
  readonly requestId: string;
  readonly issues?: readonly CloudInputIssue[];
}

// `string & {}` keeps autocomplete for known codes while allowing codes a newer
// Cloud returns before this client is regenerated.
type OpenString = string & {};

export interface CloudApiErrorInit {
  readonly operation: string;
  readonly code: CloudErrorCode | ClientErrorCode | OpenString;
  readonly message: string;
  readonly status?: number;
  readonly hint?: string;
  readonly docsUrl?: string;
  readonly category: CloudErrorCategory | OpenString;
  readonly retryable: boolean;
  readonly correctable: boolean;
  readonly requestId?: string;
  readonly issues?: readonly CloudInputIssue[];
  readonly cause?: unknown;
}

/**
 * A failed Cloud operation. Carries Cloud's error envelope as-is, so callers
 * (and agents) can branch on `code`, show `hint`, retry when `retryable`, fix
 * `issues` when `correctable`, and quote `requestId` to support.
 */
export class CloudApiError extends Error {
  /** The operation that failed, e.g. `drafts.promote`. */
  readonly operation: string;
  readonly code: CloudErrorCode | ClientErrorCode | OpenString;
  /** HTTP status; absent when the request never got a response. */
  readonly status: number | undefined;
  /** The next action, in one sentence. */
  readonly hint: string | undefined;
  readonly docsUrl: string | undefined;
  readonly category: CloudErrorCategory | OpenString;
  /** Retrying the same request may succeed. */
  readonly retryable: boolean;
  /** The input was wrong; fix it (see `issues`) and retry. */
  readonly correctable: boolean;
  /** From the envelope, or the `x-hypequery-request-id` header. */
  readonly requestId: string | undefined;
  readonly issues: readonly CloudInputIssue[] | undefined;

  constructor(init: CloudApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'CloudApiError';
    this.operation = init.operation;
    this.code = init.code;
    this.status = init.status;
    this.hint = init.hint;
    this.docsUrl = init.docsUrl;
    this.category = init.category;
    this.retryable = init.retryable;
    this.correctable = init.correctable;
    this.requestId = init.requestId;
    this.issues = init.issues;
  }

  /** The error as Cloud's envelope body, e.g. for `--json` output. */
  toJSON(): Record<string, unknown> {
    return {
      operation: this.operation,
      code: this.code,
      message: this.message,
      status: this.status,
      hint: this.hint,
      docsUrl: this.docsUrl,
      category: this.category,
      retryable: this.retryable,
      correctable: this.correctable,
      requestId: this.requestId,
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

export function isCloudApiError(error: unknown): error is CloudApiError {
  return error instanceof CloudApiError;
}
