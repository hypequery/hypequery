import { abortReason, raceWithAbort } from './abort.js';

interface CloseableResult {
  close(): void | Promise<void>;
}

function closeResult(result: CloseableResult): void {
  try {
    void Promise.resolve(result.close()).catch(() => undefined);
  } catch {
    // Closing an already-consumed result is safe to ignore.
  }
}

/** Keeps cancellation attached while a ClickHouse result body is consumed. */
export function consumeResultWithAbort<T>(
  signal: AbortSignal | undefined,
  result: CloseableResult,
  consume: () => Promise<T>
): Promise<T> {
  if (!signal) {
    return consume();
  }
  if (signal.aborted) {
    closeResult(result);
    return Promise.reject(abortReason(signal));
  }

  let pending: Promise<T>;
  try {
    pending = consume();
  } catch (error) {
    return Promise.reject(error);
  }

  return raceWithAbort(pending, signal, () => closeResult(result));
}
