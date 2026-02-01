import type { ServeErrorType } from './types.js';

/**
 * Structured error class for hypequery serve handlers and middleware.
 *
 * Throw this from a handler or middleware to return a specific HTTP status
 * and error type to the client. The pipeline catch block recognises the
 * `status` + `payload` shape and forwards it as-is.
 *
 * @example
 * ```ts
 * throw new ServeHttpError(403, 'UNAUTHORIZED', 'Insufficient permissions');
 * throw new ServeHttpError(429, 'RATE_LIMITED', 'Too fast', { 'retry-after': '60' });
 * ```
 */
export class ServeHttpError extends Error {
  readonly status: number;
  readonly payload: { type: ServeErrorType; message: string };
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    type: ServeErrorType,
    message: string,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ServeHttpError';
    this.status = status;
    this.payload = { type, message };
    this.headers = headers;
  }
}
