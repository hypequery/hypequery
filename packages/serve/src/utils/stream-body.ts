const STREAM_BODY = Symbol.for('hypequery.serve.streamBody');

/**
 * A response body sent as it is produced rather than serialized whole. Return
 * one from an endpoint handler (see {@link streamBody}); the adapters write it
 * chunk by chunk and cancel it when the client goes away.
 *
 * The request's `onRequestEnd` or `onError` hook, and its query log entry,
 * fire when the stream finishes rather than when it opens, with the stream's
 * full duration and outcome.
 */
export interface ServeStreamBody {
  readonly [STREAM_BODY]: true;
  /** The response's `content-type`. */
  readonly contentType: string;
  readonly stream: ReadableStream<Uint8Array>;
  /**
   * For a stream that reports a failure in-band, such as a final error frame,
   * and then ends normally: returns the error it absorbed, or `undefined` when
   * it succeeded. Read once the stream has ended.
   */
  readonly failure?: () => unknown;
}

export interface ServeStreamBodyOptions {
  /**
   * For a stream that reports a failure in-band (for example a final error
   * frame) and then ends normally: returns the error it absorbed, or
   * `undefined` when it succeeded. Called once the stream has ended, so the
   * failure still reaches `onError` and the query log. A stream that errors
   * needs no `failure`: the error is reported as it is.
   */
  failure?: () => unknown;
}

/** Wraps *stream* as a response body the adapters send as it is produced. */
export function streamBody(
  stream: ReadableStream<Uint8Array>,
  contentType: string,
  options: ServeStreamBodyOptions = {},
): ServeStreamBody {
  return {
    [STREAM_BODY]: true,
    contentType,
    stream,
    ...(options.failure ? { failure: options.failure } : {}),
  };
}

export function isServeStreamBody(value: unknown): value is ServeStreamBody {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[STREAM_BODY] === true;
}
