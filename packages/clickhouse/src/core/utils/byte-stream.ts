import { abortReason } from './abort.js';
import { openStreamReader, type StreamReader } from './streaming-helpers.js';
import {
  EXCEPTION_BLOCK_MAX_BYTES,
  endsWith,
  findUntaggedStreamException,
  splitStreamException,
  type StreamException,
} from './stream-exception.js';

export interface ByteStreamOptions {
  /** The response's exception tag; when set, a trailing exception block fails the stream. */
  exceptionTag?: string;
  /**
   * Bytes every complete body ends with, such as Arrow's end-of-stream marker.
   * A body that ends without them fails the stream, which catches a mid-stream
   * failure on servers that send no exception tag (before ClickHouse 25.11).
   */
  endMarker?: Uint8Array;
  abortSignal?: AbortSignal;
}

/**
 * Exposes a raw response body (Arrow IPC, Parquet, …) as a web byte stream.
 *
 * With an exception tag, the last {@link EXCEPTION_BLOCK_MAX_BYTES} bytes are
 * held until the body ends, so a mid-stream ClickHouse failure reaches the
 * consumer as ClickHouse's own error rather than as the exception text spliced
 * into the data, which a decoder would misreport or, worse, partly accept.
 * With an end marker, the same held bytes show whether the body is complete.
 */
export function createByteStream(
  source: NodeJS.ReadableStream | ReadableStream<Uint8Array>,
  options: ByteStreamOptions = {},
): ReadableStream<Uint8Array> {
  const { exceptionTag, endMarker, abortSignal } = options;
  const holdsTail = exceptionTag !== undefined || endMarker !== undefined;
  let readerPromise: Promise<StreamReader> | undefined;
  let onAbort: (() => void) | undefined;
  let held: Uint8Array = new Uint8Array(0);

  const ensureReader = () => (readerPromise ??= openStreamReader(source));
  const fail = (controller: ReadableStreamDefaultController<Uint8Array>, failure: StreamException) => {
    if (failure.data.length) controller.enqueue(failure.data);
    controller.error(failure.error);
  };
  /**
   * ClickHouse's error in a body known to be cut short: the tagged block, or,
   * from servers before 25.11, the plain exception text they append.
   */
  const exceptionInCutBody = (): StreamException | undefined => {
    if (exceptionTag) return splitStreamException(held, exceptionTag);
    return endMarker ? findUntaggedStreamException(held) : undefined;
  };
  /** Why a body that has ended is not a complete result, if it is not. */
  const incompleteBody = (): StreamException | undefined => {
    const tagged = exceptionTag ? splitStreamException(held, exceptionTag) : undefined;
    if (tagged || !endMarker || endsWith(held, endMarker)) return tagged;
    const untagged = exceptionTag ? undefined : findUntaggedStreamException(held);
    return untagged ?? {
      data: held,
      error: new Error(
        'The ClickHouse response ended before the end of the result, so the result is incomplete.' +
        (exceptionTag ? '' : ' ClickHouse may have failed mid-stream; servers before 25.11 do not report why.'),
      ),
    };
  };
  const detachAbort = () => {
    if (onAbort) {
      abortSignal?.removeEventListener('abort', onAbort);
      onAbort = undefined;
    }
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (!abortSignal) return;
      // The clients stop honoring the signal once headers arrive, so aborting
      // must both error the consumer and drop the source.
      const abort = () => {
        detachAbort();
        controller.error(abortReason(abortSignal));
        ensureReader().then(reader => reader.close()).catch(() => undefined);
      };
      if (abortSignal.aborted) {
        abort();
        return;
      }
      onAbort = abort;
      abortSignal.addEventListener('abort', onAbort, { once: true });
    },
    async pull(controller) {
      try {
        const reader = await ensureReader();
        // A pull that enqueues nothing is not called again, so read until
        // there is something to release or the body has ended.
        for (;;) {
          const { done, value } = await reader.readNext();

          if (done) {
            detachAbort();
            const failure = incompleteBody();
            if (failure) {
              fail(controller, failure);
              return;
            }
            if (held.length) controller.enqueue(held);
            controller.close();
            return;
          }

          const bytes = toBytes(value);
          if (!holdsTail) {
            if (!bytes.length) continue;
            controller.enqueue(bytes);
            return;
          }
          const joined = concat(held, bytes);
          const release = joined.length - EXCEPTION_BLOCK_MAX_BYTES;
          if (release <= 0) {
            held = joined;
            continue;
          }
          controller.enqueue(joined.subarray(0, release));
          held = joined.slice(release);
          return;
        }
      } catch (error) {
        detachAbort();
        const reader = await ensureReader();
        await reader.close();
        // ClickHouse resets the connection right after the exception block,
        // so the read fails with a bare socket error once the block is in.
        const exception = abortSignal?.aborted ? undefined : exceptionInCutBody();
        if (exception) {
          fail(controller, exception);
          return;
        }
        throw error;
      }
    },
    async cancel() {
      detachAbort();
      const reader = await ensureReader();
      await reader.close();
    },
  });
}

function toBytes(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  throw new TypeError('Expected a byte chunk from the response stream.');
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (!a.length) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a, 0);
  joined.set(b, a.length);
  return joined;
}
