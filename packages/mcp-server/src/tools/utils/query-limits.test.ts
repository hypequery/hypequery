import { describe, expect, it } from 'vitest';
import { applyQueryLimits, resolveQueryLimits } from './query-limits.js';

describe('query limits', () => {
  it('applies bounded package defaults', () => {
    expect(applyQueryLimits({}, {})).toEqual({ limit: 100 });
    expect(resolveQueryLimits({})).toMatchObject({
      defaultResultSize: 100,
      maxResultSize: 10_000,
      maxOffset: 10_000,
    });
  });

  it('uses the most restrictive Dataset and server result ceilings', () => {
    expect(resolveQueryLimits(
      { limits: { maxResultSize: 25 } },
      { defaultResultSize: 50, maxResultSize: 75 },
    )).toMatchObject({ defaultResultSize: 25, maxResultSize: 25 });
  });

  it('preserves an explicit limit within the effective ceiling', () => {
    expect(applyQueryLimits({}, { limit: 12, offset: 5 })).toEqual({
      limit: 12,
      offset: 5,
    });
  });

  it('rejects result and offset values above effective ceilings', () => {
    expect(() => applyQueryLimits({}, { limit: 11 }, { maxResultSize: 10 }))
      .toThrow('Invalid limit: 11. Max: 10');
    expect(() => applyQueryLimits({}, { offset: 11 }, { maxOffset: 10 }))
      .toThrow('Invalid offset: 11. Max: 10');
  });

  it('enforces Dataset collection limits', () => {
    expect(() => applyQueryLimits(
      { limits: { maxDimensions: 1, maxMeasures: 1, maxFilters: 1 } },
      { dimensions: ['region', 'status'] },
    )).toThrow('Invalid dimensions: maximum 1 items');
    expect(() => applyQueryLimits(
      { limits: { maxMeasures: 1 } },
      { measures: ['revenue', 'count'] },
    )).toThrow('Invalid measures: maximum 1 items');
    expect(() => applyQueryLimits(
      { limits: { maxFilters: 1 } },
      { filters: [{}, {}] },
    )).toThrow('Invalid filters: maximum 1 items');
  });

  it('enforces server order limits', () => {
    expect(() => applyQueryLimits(
      {},
      { orderBy: [{}, {}] },
      { maxOrderBy: 1 },
    )).toThrow('Invalid orderBy: maximum 1 items');
  });

  it('rejects unsafe server and Dataset configuration', () => {
    expect(() => resolveQueryLimits({}, { defaultResultSize: 0 }))
      .toThrow('defaultResultSize must be an integer between 1 and 10000');
    expect(() => resolveQueryLimits({}, { maxOffset: 10_001 }))
      .toThrow('maxOffset must be an integer between 1 and 10000');
    expect(() => resolveQueryLimits({ limits: { maxResultSize: 0 } }))
      .toThrow('Dataset maxResultSize must be a positive integer');
    expect(() => resolveQueryLimits({ limits: { maxFilters: Number.NaN } }))
      .toThrow('Dataset maxFilters must be a positive integer');
  });
});
