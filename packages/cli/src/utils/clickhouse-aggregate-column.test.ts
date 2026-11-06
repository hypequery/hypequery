import { describe, expect, it } from 'vitest';
import { aggregateColumnOf } from './clickhouse-aggregate-column.js';

describe('aggregateColumnOf', () => {
  it.each([
    ['AggregateFunction(uniq, UInt64)', { kind: 'state', function: 'uniq', stateFunction: 'uniq' }],
    ['AggregateFunction(count)', { kind: 'state', function: 'count', stateFunction: 'count' }],
    ['AggregateFunction(sum, Decimal(12, 2))', { kind: 'state', function: 'sum', stateFunction: 'sum' }],
    // Parametric states need their parameters to merge, which a measure can't carry.
    ['AggregateFunction(quantile(0.9), Float64)', { kind: 'state', function: 'quantile(0.9)' }],
    ['AggregateFunction(groupArray, String)', { kind: 'state', function: 'groupArray' }],
    ['SimpleAggregateFunction(max, UInt64)', { kind: 'simple', function: 'max' }],
    ['SimpleAggregateFunction(sum, Nullable(Float64))', { kind: 'simple', function: 'sum' }],
  ])('%s', (type, expected) => {
    expect(aggregateColumnOf(type)).toEqual(expected);
  });

  it.each(['UInt64', 'Nullable(UInt64)', 'Array(UInt64)', 'Tuple(a UInt64)'])('%s is not an aggregate column', (type) => {
    expect(aggregateColumnOf(type)).toBeNull();
  });
});
