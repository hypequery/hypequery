import { describe, expect, it } from 'vitest';
import { countBucket, durationBucket } from './buckets.js';

describe('telemetry buckets', () => {
  it.each([[0, '0'], [1, '1'], [2, '2-5'], [5, '2-5'], [6, '6-20'], [20, '6-20'], [21, '21-100'], [100, '21-100'], [101, '101+']])('counts %s as %s', (input, bucket) => {
    expect(countBucket(input as number)).toBe(bucket);
  });
  it.each([[0, '<100ms'], [99.99, '<100ms'], [100, '100ms-1s'], [999.99, '100ms-1s'], [1_000, '1s-10s'], [10_000, '10s-1m'], [60_000, '1m-10m'], [600_000, '10m-1h'], [3_600_000, '1h+']])('durations %s as %s', (input, bucket) => {
    expect(durationBucket(input as number)).toBe(bucket);
  });
  it.each([-1, NaN, Infinity, -Infinity])('omits invalid measures %s', input => {
    expect(countBucket(input)).toBeUndefined();
    expect(durationBucket(input)).toBeUndefined();
  });
  it('omits fractional or unsafe counts', () => {
    for (const input of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(countBucket(input)).toBeUndefined();
    }
  });
});
