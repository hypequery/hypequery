export interface CacheWriteScope {
  key: string;
  namespace: string;
  tags: readonly string[];
}

type ScopeMatcher = (scope: CacheWriteScope) => boolean;

interface PendingWrite {
  scope: CacheWriteScope;
  promise: Promise<void>;
}

interface PendingInvalidation {
  matches: ScopeMatcher;
  promise: Promise<void>;
}

function settle(operation: Promise<void>): Promise<void> {
  return operation.catch(() => undefined);
}

/**
 * Orders writes and invalidations without serializing mutations for unrelated
 * keys. Earlier matching writes finish before an invalidation, while matching
 * writes registered afterward wait for that invalidation to finish.
 */
export class CacheMutationCoordinator {
  private tails = new Map<string, Promise<void>>();
  private pendingWrites = new Set<PendingWrite>();
  private pendingInvalidations = new Set<PendingInvalidation>();

  enqueueWrite(scope: CacheWriteScope, write: () => Promise<void>): Promise<void> {
    const previous = this.tails.get(scope.key);
    const invalidations = Array.from(this.pendingInvalidations)
      .filter(invalidation => invalidation.matches(scope))
      .map(invalidation => settle(invalidation.promise));
    const prerequisites = previous
      ? [settle(previous), ...invalidations]
      : invalidations;
    const current = Promise.all(prerequisites).then(() => write());
    const pending = { scope, promise: current };

    this.tails.set(scope.key, current);
    this.pendingWrites.add(pending);
    void current
      .finally(() => {
        this.pendingWrites.delete(pending);
        if (this.tails.get(scope.key) === current) {
          this.tails.delete(scope.key);
        }
      })
      .catch(() => undefined);

    return current;
  }

  invalidate(matches: ScopeMatcher, operation: () => Promise<void>): Promise<void> {
    const writes = Array.from(this.pendingWrites)
      .filter(write => matches(write.scope))
      .map(write => settle(write.promise));
    // Invalidation is rare, and serializing overlapping calls makes their
    // ordering deterministic without blocking unrelated cache writes.
    const invalidations = Array.from(this.pendingInvalidations)
      .map(invalidation => settle(invalidation.promise));
    const current = Promise.all([...writes, ...invalidations])
      .then(() => operation());
    const pending = { matches, promise: current };

    // Register the barrier synchronously so later matching writes cannot race
    // the provider operation while this invalidation waits for earlier writes.
    this.pendingInvalidations.add(pending);
    void current
      .finally(() => {
        this.pendingInvalidations.delete(pending);
      })
      .catch(() => undefined);

    return current;
  }
}
