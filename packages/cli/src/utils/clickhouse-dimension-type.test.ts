import { describe, expect, it } from 'vitest';
import {
  clickHouseDimensionType,
  namedTupleElements,
  unwrapClickHouseType,
} from './clickhouse-dimension-type.js';

describe('clickHouseDimensionType', () => {
  it.each([
    ['UInt64', 'number'],
    ['Int8', 'number'],
    ['Float64', 'number'],
    ['Decimal(10, 2)', 'number'],
    ['Decimal128(4)', 'number'],
    ['Date', 'timestamp'],
    ['Date32', 'timestamp'],
    ["DateTime('UTC')", 'timestamp'],
    ["DateTime64(3, 'Europe/London')", 'timestamp'],
    ['Bool', 'boolean'],
    ['String', 'string'],
    ['FixedString(16)', 'string'],
    ['UUID', 'string'],
    ['IPv4', 'string'],
    ['IPv6', 'string'],
    ["Enum8('card' = 1, 'cash' = 2)", 'string'],
    ['LowCardinality(String)', 'string'],
    ['Nullable(Float64)', 'number'],
    ['LowCardinality(Nullable(String))', 'string'],
    ['SimpleAggregateFunction(sum, UInt64)', 'number'],
  ] as const)('maps %s to %s', (type, expected) => {
    expect(clickHouseDimensionType(type)).toBe(expected);
  });

  it.each([
    // Each of these read as a scalar under substring matching.
    'Point',
    'Array(Int32)',
    'Array(String)',
    'Array(Date)',
    'Tuple(Float64, Float64)',
    'Tuple(country String, lat Float64)',
    'Map(String, UInt64)',
    'IntervalDay',
    'Nullable(Array(String))',
    "JSON",
    'Object(\'json\')',
    'Variant(String, UInt64)',
    'Ring',
    'AggregateFunction(uniq, String)',
  ])('has no dimension type for %s', (type) => {
    expect(clickHouseDimensionType(type)).toBeNull();
  });
});

describe('unwrapClickHouseType', () => {
  it('removes value-preserving wrappers', () => {
    expect(unwrapClickHouseType(' LowCardinality(Nullable(String)) ')).toBe('String');
    expect(unwrapClickHouseType('SimpleAggregateFunction(max, Nullable(DateTime))')).toBe('DateTime');
    expect(unwrapClickHouseType('Array(Nullable(String))')).toBe('Array(Nullable(String))');
  });
});

describe('namedTupleElements', () => {
  it('returns the scalar elements of a named tuple', () => {
    expect(
      namedTupleElements("Tuple(country LowCardinality(String), lat Float64, seen_at DateTime64(3, 'UTC'))"),
    ).toEqual([
      { name: 'country', type: 'string' },
      { name: 'lat', type: 'number' },
      { name: 'seen_at', type: 'timestamp' },
    ]);
  });

  it('leaves out elements without a scalar type or an identifier name', () => {
    expect(namedTupleElements('Tuple(tags Array(String), `odd name` String, ok Bool)')).toEqual([
      { name: 'ok', type: 'boolean' },
    ]);
  });

  it('ignores unnamed tuples and other types', () => {
    expect(namedTupleElements('Tuple(Float64, Float64)')).toBeNull();
    expect(namedTupleElements("Tuple(DateTime64(3, 'UTC'), String)")).toBeNull();
    expect(namedTupleElements('Map(String, UInt64)')).toBeNull();
    expect(namedTupleElements('String')).toBeNull();
  });
});
