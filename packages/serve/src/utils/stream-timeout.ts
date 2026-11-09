/**
 * Why the server stopped a streamed response early: it sent nothing for the
 * idle timeout, ran past the total stream timeout, or opened only after the
 * request had already timed out with a 504.
 */
export type StreamTimeoutKind = 'idle' | 'total' | 'request';

const MESSAGES: Record<StreamTimeoutKind, (ms: number) => string> = {
  idle: ms => `The stream sent nothing for ${ms}ms`,
  total: ms => `The stream did not finish within ${ms}ms`,
  request: ms => `The stream opened after the request timed out (${ms}ms)`,
};

/** The reason a stream is cancelled with when the server times it out. */
export class StreamTimeoutError extends Error {
  readonly code = 'STREAM_TIMEOUT';

  constructor(readonly kind: StreamTimeoutKind, readonly timeoutMs: number) {
    super(MESSAGES[kind](timeoutMs));
    this.name = 'StreamTimeoutError';
  }
}

export function isStreamTimeoutError(value: unknown): value is StreamTimeoutError {
  return value instanceof StreamTimeoutError;
}
