import type { ServeStreamOutcome } from '../types.js';
import { isStreamTimeoutError } from './stream-timeout.js';
import { streamBody, type ServeStreamBody } from './stream-body.js';

/** How an observed stream ended. `error` is set when `outcome` is `failed`. */
export interface StreamSettlement {
  outcome: ServeStreamOutcome;
  bytes: number;
  error?: unknown;
}

/**
 * *body* with a stream that calls *onSettled* exactly once, when the stream
 * ends, fails, or is cancelled, before the reader sees that end. A failure
 * the body absorbed in-band (its `failure`) counts as `failed`, as does a
 * cancellation whose reason is a stream timeout. Chunks pass through unchanged
 * and are pulled only when the reader asks, so backpressure is preserved.
 */
export function observeStreamBody(
  body: ServeStreamBody,
  onSettled: (settlement: StreamSettlement) => Promise<void> | void,
): ServeStreamBody {
  const reader = body.stream.getReader();
  let bytes = 0;
  let settled = false;
  let cancelled = false;

  const settle = async (outcome: ServeStreamOutcome, error?: unknown) => {
    if (settled) return;
    settled = true;
    try {
      await onSettled(outcome === 'failed' ? { outcome, bytes, error } : { outcome, bytes });
    } catch {
      // Reporting must never break the response.
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        await settle('failed', error);
        if (!cancelled) controller.error(error);
        return;
      }
      if (cancelled) return;
      if (chunk.done) {
        const absorbed = body.failure?.();
        await settle(absorbed === undefined ? 'completed' : 'failed', absorbed);
        if (!cancelled) controller.close();
        return;
      }
      bytes += chunk.value.byteLength;
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      cancelled = true;
      await Promise.all([
        reader.cancel(reason).catch(() => undefined),
        isStreamTimeoutError(reason) ? settle('failed', reason) : settle('cancelled'),
      ]);
    },
  }, { highWaterMark: 0 });

  return streamBody(stream, body.contentType);
}
