import { COUNT_BUCKETS, DURATION_BUCKETS, SIZE_BUCKETS } from './domains.js';

/** Invalid measurements are omitted rather than coerced into a misleading bucket. */
export function countBucket(count: number): typeof COUNT_BUCKETS[number] | undefined {
  if (!Number.isSafeInteger(count) || count < 0) return undefined;
  if (count === 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  if (count <= 100) return '21-100';
  return '101+';
}

export function durationBucket(milliseconds: number): typeof DURATION_BUCKETS[number] | undefined {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined;
  const boundaries = [100, 1_000, 10_000, 60_000, 600_000, 3_600_000];
  return DURATION_BUCKETS[boundaries.findIndex(boundary => milliseconds < boundary)] ?? '1h+';
}

export function sizeBucket(bytes: number): typeof SIZE_BUCKETS[number] | undefined {
  if (!Number.isSafeInteger(bytes) || bytes < 0) return undefined;
  if (bytes === 0) return '0';
  if (bytes < 10 * 1024) return '<10KiB';
  if (bytes < 100 * 1024) return '10KiB-100KiB';
  if (bytes < 1024 * 1024) return '100KiB-1MiB';
  if (bytes < 10 * 1024 * 1024) return '1MiB-10MiB';
  return '10MiB+';
}
