import { describe, expect, it } from 'vitest';
import { GRAIN_FUNCTIONS } from './constants.js';
import { utcBucketStart } from './utils/time-measure-axis.js';

// Weeks start on Monday (ISO 8601) on every path: the ClickHouse lowering,
// the in-memory backend's default, and the JavaScript bucket estimate.
describe('week start', () => {
  it('lowers the week grain to toMonday, not Sunday-based toStartOfWeek', () => {
    expect(GRAIN_FUNCTIONS.week).toBe('toMonday');
  });

  it.each([
    ['2026-10-04T12:00:00Z', '2026-09-28T00:00:00.000Z'], // Sunday belongs to the previous week
    ['2026-10-05T00:00:00Z', '2026-10-05T00:00:00.000Z'], // Monday starts a week
    ['2026-10-10T23:59:59Z', '2026-10-05T00:00:00.000Z'], // Saturday
  ])('aligns %s to the Monday %s', (input, expected) => {
    expect(new Date(utcBucketStart(Date.parse(input), 'week')).toISOString()).toBe(expected);
  });
});
