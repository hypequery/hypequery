import { describe, expect, it, vi } from 'vitest';
import { createMemoryDedupe } from './dispatch.js';

describe('createMemoryDedupe', () => {
  it('claims a key once until it expires', () => {
    vi.useFakeTimers();
    try {
      const dedupe = createMemoryDedupe({ ttlMs: 1000 });
      expect(dedupe.claim('a')).toBe(true);
      expect(dedupe.claim('a')).toBe(false);
      vi.advanceTimersByTime(1001);
      expect(dedupe.claim('a')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts the oldest keys past maxEntries', () => {
    const dedupe = createMemoryDedupe({ maxEntries: 2 });
    dedupe.claim('a');
    dedupe.claim('b');
    dedupe.claim('c');
    expect(dedupe.claim('a')).toBe(true);
    expect(dedupe.claim('c')).toBe(false);
  });
});
