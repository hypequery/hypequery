const STREAM_BODY = Symbol.for('hypequery.serve.streamBody');

/**
 * A response body sent as it is produced rather than serialized whole. Return
 * one from an endpoint handler (see {@link streamBody}); the adapters write it
 * chunk by chunk and cancel it when the client goes away.
 */
export interface ServeStreamBody {
  readonly [STREAM_BODY]: true;
  /** The response's `content-type`. */
  readonly contentType: string;
  readonly stream: ReadableStream<Uint8Array>;
}

/** Wraps *stream* as a response body the adapters send as it is produced. */
export function streamBody(stream: ReadableStream<Uint8Array>, contentType: string): ServeStreamBody {
  return { [STREAM_BODY]: true, contentType, stream };
}

export function isServeStreamBody(value: unknown): value is ServeStreamBody {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[STREAM_BODY] === true;
}
