import { describe, expect, it } from 'vitest';
import { advertiseDatasetQueryLimits, type JsonObject } from './query-schema.js';

const querySchema: JsonObject = {
  type: 'object',
  properties: {
    dataset: { type: 'string' },
    dimensions: { type: 'array' },
    measures: { type: 'array' },
    filters: { type: 'array' },
    orderBy: { type: 'array' },
    limit: { type: 'integer' },
    offset: { type: 'integer' },
  },
  required: ['dataset'],
};

describe('dataset query limit schema', () => {
  it('preserves the generic schema when no datasets are registered', () => {
    expect(advertiseDatasetQueryLimits(querySchema, {}, undefined, true))
      .toBe(querySchema);
  });

  it('advertises effective limits in a schema branch for each dataset', () => {
    const result = advertiseDatasetQueryLimits(
      querySchema,
      {
        orders: { limits: { maxDimensions: 1, maxFilters: 2, maxResultSize: 25 } },
        customers: { limits: { maxMeasures: 3 } },
      },
      {
        defaultResultSize: 30,
        maxResultSize: 50,
        maxOffset: 40,
        maxDimensions: 4,
        maxMeasures: 5,
        maxFilters: 6,
        maxOrderBy: 7,
      },
      true,
    ) as { anyOf: Array<{ properties: Record<string, JsonObject> }> };

    expect(result.anyOf).toHaveLength(2);
    expect(result.anyOf[0].properties).toMatchObject({
      dataset: { enum: ['orders'] },
      dimensions: { maxItems: 1 },
      measures: { maxItems: 5 },
      filters: { maxItems: 2 },
      orderBy: { maxItems: 7 },
      limit: { maximum: 25, default: 25 },
      offset: { maximum: 40 },
    });
    expect(result.anyOf[1].properties).toMatchObject({
      dataset: { enum: ['customers'] },
      dimensions: { maxItems: 4 },
      measures: { maxItems: 3 },
      filters: { maxItems: 6 },
      limit: { maximum: 50, default: 30 },
    });
  });

  it('does not add a measures constraint to metric query schemas', () => {
    const result = advertiseDatasetQueryLimits(
      querySchema,
      { orders: { limits: { maxMeasures: 1 } } },
      undefined,
      false,
    ) as { anyOf: Array<{ properties: Record<string, JsonObject> }> };

    expect(result.anyOf[0].properties.measures).toEqual({ type: 'array' });
  });
});
