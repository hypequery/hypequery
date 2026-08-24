import { abortReason } from '../utils/abort.js';

/** One deduplicated execution shared by every caller of the same cache key. */
export interface SharedFetch {
  promise: Promise<unknown>;
  controller: AbortController;
  abortableWaiters: number;
  pinnedWaiters: number;
}

/**
 * Joins a caller to a shared fetch without allowing that caller to cancel
 * anyone else. The underlying fetch is aborted only after its final waiter
 * leaves.
 */
export function joinSharedFetch<T>(shared: SharedFetch, abortSignal?: AbortSignal): Promise<T> {
  if (!abortSignal) {
    shared.pinnedWaiters += 1;
    return (shared.promise as Promise<T>).finally(() => {
      shared.pinnedWaiters -= 1;
    });
  }
  if (abortSignal.aborted) {
    return Promise.reject(abortReason(abortSignal));
  }

  shared.abortableWaiters += 1;
  return new Promise<T>((resolve, reject) => {
    let waiting = true;

    const leave = () => {
      if (!waiting) return;
      waiting = false;
      shared.abortableWaiters -= 1;
      abortSignal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      leave();
      if (shared.abortableWaiters === 0 && shared.pinnedWaiters === 0) {
        shared.controller.abort(abortSignal.reason);
      }
      reject(abortReason(abortSignal));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(
      value => {
        leave();
        resolve(value as T);
      },
      error => {
        leave();
        reject(error);
      }
    );
  });
}
