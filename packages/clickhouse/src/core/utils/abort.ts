export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The query was aborted.');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

/** Rejects promptly on abort while allowing the underlying operation to settle safely. */
export function raceWithAbort<T>(
  operation: Promise<T>,
  signal?: AbortSignal,
  onAbort?: () => void
): Promise<T> {
  if (!signal) {
    return operation;
  }

  const handleAbort = () => {
    try {
      onAbort?.();
    } catch {
      // Cleanup failures must not replace the caller's abort reason.
    }
  };

  if (signal.aborted) {
    handleAbort();
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const detachAbort = () => signal.removeEventListener('abort', handleSignalAbort);
    const handleSignalAbort = () => {
      detachAbort();
      handleAbort();
      reject(abortReason(signal));
    };

    signal.addEventListener('abort', handleSignalAbort, { once: true });
    operation.then(
      value => {
        detachAbort();
        resolve(value);
      },
      error => {
        detachAbort();
        reject(error);
      }
    );
  });
}
