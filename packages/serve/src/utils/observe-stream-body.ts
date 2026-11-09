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
 * ends, fails, or is cancelled. It is called before the reader sees that end
 * but never waited for: a slow reporter must not hold the response open (and
 * so run it into a stream timeout). A failure the body absorbed in-band (its
 * `failure`) counts as `failed`, even when the client cancels after reading
 * the error frame, as does a cancellation whose reason is a stream timeout.
 * Chunks pass through unchanged and are pulled only when the reader asks, so
 * backpressure is preserved.
 */
export function observeStreamBody(
  body: ServeStreamBody,
  onSettled: (settlement: StreamSettlement) => Promise<void> | void,
): ServeStreamBody {
  const reader = body.stream.getReader();
  let bytes = 0;
  let settled = false;
  let cancelled = false;

  const settle = (outcome: ServeStreamOutcome, error?: unknown) => {
    if (settled) return;
    settled = true;
    try {
      const reported = onSettled(outcome === 'failed' ? { outcome, bytes, error } : { outcome, bytes });
      // Reporting must never break the response.
      void Promise.resolve(reported).catch(() => undefined);
    } catch {
      // Reporting must never break the response.
    }
  };
  /** Settles on what the body itself recorded, if anything, else on *fallback*. */
  const settleWithAbsorbed = (fallback: ServeStreamOutcome, fallbackError?: unknown) => {
    const absorbed = body.failure?.();
    if (absorbed !== undefined) settle('failed', absorbed);
    else settle(fallback, fallbackError);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        settle('failed', error);
        if (!cancelled) controller.error(error);
        return;
      }
      if (cancelled) return;
      if (chunk.done) {
        settleWithAbsorbed('completed');
        controller.close();
        return;
      }
      bytes += chunk.value.byteLength;
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      cancelled = true;
      if (isStreamTimeoutError(reason)) settle('failed', reason);
      else settleWithAbsorbed('cancelled');
      await reader.cancel(reason).catch(() => undefined);
    },
  }, { highWaterMark: 0 });

  return streamBody(stream, body.contentType);
}
