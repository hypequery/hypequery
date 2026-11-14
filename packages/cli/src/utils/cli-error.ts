import type { ERROR_CODES } from './telemetry/domains.js';
import type { ExitClass } from './exit-codes.js';

/**
 * Decision 0003's nine public error categories, shared with Cloud's `/v1`
 * operations and MCP, so an agent learns one vocabulary.
 */
export const CLI_ERROR_CATEGORIES = [
  'correctable_input',
  'unauthenticated',
  'forbidden',
  'tenant_unavailable',
  'budget_exceeded',
  'cancelled',
  'stale_contract',
  'unavailable',
  'internal',
] as const;
export type CliErrorCategory = typeof CLI_ERROR_CATEGORIES[number];

/** The category a failure has when the CLI knows only its exit class. */
export const DEFAULT_CATEGORY: Readonly<Record<ExitClass, CliErrorCategory>> = {
  correctable: 'correctable_input',
  auth: 'unauthenticated',
  plan: 'budget_exceeded',
  transient: 'unavailable',
  internal: 'internal',
};

/** The exit class each category exits with; `exitClass` follows `category` when only that is given. */
const CATEGORY_EXIT_CLASS: Readonly<Record<CliErrorCategory, ExitClass>> = {
  correctable_input: 'correctable',
  stale_contract: 'correctable',
  tenant_unavailable: 'correctable',
  cancelled: 'correctable',
  unauthenticated: 'auth',
  forbidden: 'auth',
  budget_exceeded: 'plan',
  unavailable: 'transient',
  internal: 'internal',
};

/** A field, flag or file that failed, by path (Cloud's `InputIssue`). */
export interface CliInputIssue {
  readonly path: string;
  readonly message: string;
}

export interface CliErrorOptions {
  /** One sentence naming the next action, e.g. "Run `hypequery login`." */
  readonly hint?: string;
  readonly exitClass?: ExitClass;
  /** The closed telemetry code; never the message. */
  readonly telemetryCode?: typeof ERROR_CODES[number];
  readonly retryable?: boolean;
  /** Decision 0003 category; defaults from the exit class. */
  readonly category?: CliErrorCategory;
  readonly issues?: readonly CliInputIssue[];
  /** Cloud's request ID, when the failure came from a Cloud response. */
  readonly requestId?: string;
  /** The page about this error, when Cloud named one; otherwise the CLI's error reference. */
  readonly docsUrl?: string;
}

/**
 * A failure the CLI reports with a stable code and the next action. `--json`
 * prints it as the shared error envelope, with `hint` as its own field; text
 * mode prints only the message, so the message must name the next action too.
 * `code` is SCREAMING_SNAKE_CASE and never changes once released.
 */
export class CliError extends Error {
  readonly hint?: string;
  readonly exitClass: ExitClass;
  readonly telemetryCode: typeof ERROR_CODES[number];
  readonly retryable: boolean;
  readonly category: CliErrorCategory;
  readonly issues?: readonly CliInputIssue[];
  readonly requestId?: string;
  readonly docsUrl?: string;

  constructor(readonly code: string, message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.exitClass = options.exitClass ?? (options.category ? CATEGORY_EXIT_CLASS[options.category] : 'correctable');
    this.category = options.category ?? DEFAULT_CATEGORY[this.exitClass];
    if (options.issues?.length) this.issues = options.issues;
    if (options.requestId) this.requestId = options.requestId;
    if (options.docsUrl) this.docsUrl = options.docsUrl;
    this.telemetryCode = options.telemetryCode ?? (this.exitClass === 'auth' ? 'auth_failed' : 'validation_failed');
    this.retryable = options.retryable ?? this.exitClass === 'transient';
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

/** The parts of Cloud's error envelope (decision 0019 §6) the CLI relays. */
export interface CloudErrorDetails {
  readonly hint?: string;
  readonly category?: CliErrorCategory;
  readonly requestId?: string;
}

/**
 * A failed Cloud HTTP request, classified by status: 401/403 is auth (sign in
 * again), 402 is the plan, 408/429/5xx is transient (retry), 409/412 means the
 * live state changed, anything else is for the caller to correct. When Cloud
 * sent its own envelope, its category, hint and request ID win. The message is
 * the caller's, unchanged.
 */
export function cloudHttpError(status: number, message: string, cloud: CloudErrorDetails = {}): CliError {
  const relayed = {
    ...(cloud.hint ? { hint: cloud.hint } : {}),
    ...(cloud.requestId ? { requestId: cloud.requestId } : {}),
  };
  const category = cloud.category === 'internal' || cloud.category === 'cancelled' ? 'unavailable' : cloud.category;
  if (category === 'unauthenticated' || category === 'forbidden' || (!category && (status === 401 || status === 403))) {
    return new CliError('CLOUD_UNAUTHORIZED', message, {
      hint: 'Run `hypequery login`, or check HYPEQUERY_API_TOKEN.',
      category: category ?? (status === 403 ? 'forbidden' : 'unauthenticated'),
      ...relayed,
    });
  }
  if (category === 'budget_exceeded' || (!category && status === 402)) {
    return new CliError('CLOUD_PLAN_LIMIT', message, {
      hint: 'Upgrade the organisation\'s plan in hypequery Cloud.',
      category: 'budget_exceeded',
      telemetryCode: 'cloud_rejected',
      ...relayed,
    });
  }
  if (category === 'unavailable' || (!category && (status === 408 || status === 429 || status >= 500))) {
    return new CliError('CLOUD_UNAVAILABLE', message, {
      hint: 'Retry in a moment.',
      category: 'unavailable',
      telemetryCode: 'cloud_network_error',
      ...relayed,
    });
  }
  if (category === 'stale_contract' || (!category && (status === 409 || status === 412))) {
    return new CliError('CLOUD_STATE_CHANGED', message, {
      hint: 'The live deployment changed since this command read it; run the command again.',
      category: 'stale_contract',
      telemetryCode: 'cloud_rejected',
      ...relayed,
    });
  }
  return new CliError('CLOUD_REQUEST_FAILED', message, {
    telemetryCode: 'cloud_rejected',
    ...(category ? { category } : {}),
    ...relayed,
  });
}

/**
 * `--check` or `--diff` found generated output missing or out of date. Still
 * exit 1, as it always was; `issues` names each file.
 */
export function outOfDateError(
  message: string,
  files: readonly { readonly path: string; readonly missing: boolean }[],
  hint: string,
): CliError {
  const anyPresent = files.some(file => !file.missing);
  return new CliError('OUT_OF_DATE', message, {
    hint,
    category: 'stale_contract',
    telemetryCode: anyPresent ? 'output_out_of_date' : 'output_missing',
    issues: files.map(file => ({ path: file.path, message: file.missing ? 'missing' : 'out of date' })),
  });
}

/** An output exists and differs; replacing it needs `--force`. */
export function outputConflictError(message: string, files: readonly string[], hint = 'Review the existing file, then rerun with --force to replace it.'): CliError {
  return new CliError('OUTPUT_EXISTS', message, {
    hint,
    issues: files.map(file => ({ path: file, message: 'exists and differs; pass --force to replace it' })),
  });
}
