import type { ERROR_CODES } from './telemetry/domains.js';
import type { ExitClass } from './exit-codes.js';

export interface CliErrorOptions {
  /** One sentence naming the next action, e.g. "Run `hypequery login`." */
  readonly hint?: string;
  readonly exitClass?: ExitClass;
  /** The closed telemetry code; never the message. */
  readonly telemetryCode?: typeof ERROR_CODES[number];
  readonly retryable?: boolean;
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

  constructor(readonly code: string, message: string, options: CliErrorOptions = {}) {
    super(message);
    this.name = 'CliError';
    this.hint = options.hint;
    this.exitClass = options.exitClass ?? 'correctable';
    this.telemetryCode = options.telemetryCode ?? (this.exitClass === 'auth' ? 'auth_failed' : 'validation_failed');
    this.retryable = options.retryable ?? this.exitClass === 'transient';
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError;
}

/**
 * A failed Cloud HTTP request, classified by status: 401/403 is auth (sign in
 * again), 408/429/5xx is transient (retry), anything else is for the caller to
 * correct. The message is the caller's, unchanged.
 */
export function cloudHttpError(status: number, message: string): CliError {
  if (status === 401 || status === 403) {
    return new CliError('CLOUD_UNAUTHORIZED', message, {
      hint: 'Run `hypequery login`, or check HYPEQUERY_API_TOKEN.',
      exitClass: 'auth',
    });
  }
  if (status === 408 || status === 429 || status >= 500) {
    return new CliError('CLOUD_UNAVAILABLE', message, {
      hint: 'Retry in a moment.',
      exitClass: 'transient',
      telemetryCode: 'cloud_network_error',
    });
  }
  return new CliError('CLOUD_REQUEST_FAILED', message, { telemetryCode: 'cloud_rejected' });
}
