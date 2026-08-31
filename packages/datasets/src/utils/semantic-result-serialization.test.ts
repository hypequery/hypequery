import { describe, expect, it } from 'vitest';
import { serializeSemanticMeasureValues } from './semantic-result-serialization.js';

describe('serializeSemanticMeasureValues', () => {
  it('stringifies selected measure values while preserving dimensions and null', () => {
    const rows = serializeSemanticMeasureValues([
      { country: 'ES', revenue: 42.5, orderCount: '3', variance: null },
    ], ['revenue', 'orderCount', 'variance']);

    expect(rows).toEqual([
      { country: 'ES', revenue: '42.5', orderCount: '3', variance: null },
    ]);
  });

  it('normalizes non-finite numeric results to null without mutating the input', () => {
    const input = [{ revenue: Number.NaN }];

    expect(serializeSemanticMeasureValues(input, ['revenue'])).toEqual([{ revenue: null }]);
    expect(Number.isNaN(input[0].revenue)).toBe(true);
  });
});
