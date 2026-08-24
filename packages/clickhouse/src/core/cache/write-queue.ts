export type CacheWriteQueue = Map<string, Promise<void>>;

/**
 * Serializes writes for one cache key. A newer result may be fetched while an
 * abandoned write is still settling, but its write always runs afterward and
 * therefore remains authoritative.
 */
export function enqueueCacheWrite(
  queue: CacheWriteQueue,
  key: string,
  write: () => Promise<void>
): Promise<void> {
  const previous = queue.get(key);
  const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
    .then(write);

  queue.set(key, current);
  void current
    .finally(() => {
      if (queue.get(key) === current) {
        queue.delete(key);
      }
    })
    .catch(() => undefined);

  return current;
}
