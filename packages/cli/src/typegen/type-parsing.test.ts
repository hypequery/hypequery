/**
 * Comprehensive Edge-Case Tests for ClickHouse Type Parsing
 *
 * Tests the type-parsing logic against nasty ClickHouse types that break naive parsers.
 * Critical for production correctness when generating types from real schemas.
 */

import { describe, expect, it } from 'vitest';
import { clickhouseToTsType } from './type-parsing.js';

describe('ClickHouse Type Parsing - Edge Cases', () => {
  describe('Nested Nullable and LowCardinality', () => {
    it('handles Nullable(LowCardinality(String))', () => {
      expect(clickhouseToTsType('Nullable(LowCardinality(String))')).toBe('string | null');
    });

    it('handles Nullable(LowCardinality(FixedString(2)))', () => {
      expect(clickhouseToTsType('Nullable(LowCardinality(FixedString(2)))')).toBe('string | null');
    });

    it('handles LowCardinality(Nullable(String))', () => {
      expect(clickhouseToTsType('LowCardinality(Nullable(String))')).toBe('string | null');
    });

    it('handles deeply nested LowCardinality(Nullable(FixedString(36)))', () => {
      // UUID columns often use FixedString(36)
      expect(clickhouseToTsType('LowCardinality(Nullable(FixedString(36)))')).toBe('string | null');
    });

    it('handles Nullable(LowCardinality(Nullable(String))) - double Nullable edge case', () => {
      // Shouldn't happen in practice, but parser should handle it
      expect(clickhouseToTsType('Nullable(LowCardinality(Nullable(String)))')).toBe('string | null | null');
    });
  });

  describe('Enum Types with Explicit Values', () => {
    it('handles Enum8 with simple values', () => {
      expect(clickhouseToTsType("Enum8('pending' = 1, 'active' = 2)")).toBe('string');
    });

    it('handles Enum16 with many values', () => {
      expect(clickhouseToTsType("Enum16('a' = 1, 'b' = 2, 'c' = 3, 'd' = 4)")).toBe('string');
    });

    it('handles Enum8 with negative values', () => {
      expect(clickhouseToTsType("Enum8('error' = -1, 'ok' = 0, 'success' = 1)")).toBe('string');
    });

    it('handles Nullable(Enum8(...))', () => {
      expect(clickhouseToTsType("Nullable(Enum8('pending' = 1, 'active' = 2))")).toBe('string | null');
    });

    it('handles LowCardinality(Enum8(...))', () => {
      expect(clickhouseToTsType("LowCardinality(Enum8('a' = 1, 'b' = 2))")).toBe('string');
    });

    it('handles Array(Enum8(...))', () => {
      expect(clickhouseToTsType("Array(Enum8('pending' = 1, 'active' = 2))")).toBe('Array<string>');
    });
  });

  describe('DateTime with Timezones and Precision', () => {
    it('handles DateTime with timezone', () => {
      expect(clickhouseToTsType("DateTime('UTC')")).toBe('string');
    });

    it('handles DateTime with different timezone', () => {
      expect(clickhouseToTsType("DateTime('America/New_York')")).toBe('string');
    });

    it('handles DateTime64 with precision and timezone', () => {
      expect(clickhouseToTsType("DateTime64(3, 'UTC')")).toBe('string');
    });

    it('handles DateTime64 with high precision', () => {
      expect(clickhouseToTsType("DateTime64(9, 'UTC')")).toBe('string');
    });

    it('handles Nullable(DateTime64(3, \'UTC\'))', () => {
      expect(clickhouseToTsType("Nullable(DateTime64(3, 'UTC'))")).toBe('string | null');
    });

    it('handles Array(DateTime64(3, \'UTC\'))', () => {
      expect(clickhouseToTsType("Array(DateTime64(3, 'UTC'))")).toBe('Array<string>');
    });
  });

  describe('Decimal Types', () => {
    it('handles Decimal(18, 4) - common for currency', () => {
      expect(clickhouseToTsType('Decimal(18, 4)')).toBe('number');
    });

    it('handles Decimal(38, 10) - high precision', () => {
      expect(clickhouseToTsType('Decimal(38, 10)')).toBe('number');
    });

    it('handles Decimal32(2)', () => {
      expect(clickhouseToTsType('Decimal32(2)')).toBe('number');
    });

    it('handles Decimal64(4)', () => {
      expect(clickhouseToTsType('Decimal64(4)')).toBe('number');
    });

    it('handles Decimal128(8)', () => {
      expect(clickhouseToTsType('Decimal128(8)')).toBe('number');
    });

    it('handles Nullable(Decimal(18, 4))', () => {
      expect(clickhouseToTsType('Nullable(Decimal(18, 4))')).toBe('number | null');
    });

    it('handles Array(Decimal(18, 4))', () => {
      expect(clickhouseToTsType('Array(Decimal(18, 4))')).toBe('Array<number>');
    });
  });

  describe('FixedString Types', () => {
    it('handles FixedString(16) - common for MD5 hashes', () => {
      expect(clickhouseToTsType('FixedString(16)')).toBe('string');
    });

    it('handles FixedString(36) - common for UUIDs', () => {
      expect(clickhouseToTsType('FixedString(36)')).toBe('string');
    });

    it('handles FixedString(2) - common for country codes', () => {
      expect(clickhouseToTsType('FixedString(2)')).toBe('string');
    });

    it('handles Nullable(FixedString(36))', () => {
      expect(clickhouseToTsType('Nullable(FixedString(36))')).toBe('string | null');
    });

    it('handles Array(FixedString(2))', () => {
      expect(clickhouseToTsType('Array(FixedString(2))')).toBe('Array<string>');
    });
  });

  describe('Array Types with Complex Elements', () => {
    it('handles Array(Nullable(String))', () => {
      expect(clickhouseToTsType('Array(Nullable(String))')).toBe('Array<string | null>');
    });

    it('handles Array(Nullable(Int32))', () => {
      expect(clickhouseToTsType('Array(Nullable(Int32))')).toBe('Array<number | null>');
    });

    it('handles Array(LowCardinality(String))', () => {
      expect(clickhouseToTsType('Array(LowCardinality(String))')).toBe('Array<string>');
    });

    it('handles Array(Nullable(LowCardinality(String)))', () => {
      expect(clickhouseToTsType('Array(Nullable(LowCardinality(String)))')).toBe('Array<string | null>');
    });

    it('handles nested Array(Array(String))', () => {
      expect(clickhouseToTsType('Array(Array(String))')).toBe('Array<Array<string>>');
    });

    it('handles Array(Array(Nullable(Int32)))', () => {
      expect(clickhouseToTsType('Array(Array(Nullable(Int32)))')).toBe('Array<Array<number | null>>');
    });
  });

  describe('Tuple Types - Complex Nested Cases', () => {
    it('handles Tuple(String, Int32)', () => {
      expect(clickhouseToTsType('Tuple(String, Int32)')).toBe('[string, number]');
    });

    it('handles Tuple(String, Nullable(Int32))', () => {
      expect(clickhouseToTsType('Tuple(String, Nullable(Int32))')).toBe('[string, number | null]');
    });

    it('handles Tuple(Nullable(String), Nullable(Int32))', () => {
      expect(clickhouseToTsType('Tuple(Nullable(String), Nullable(Int32))')).toBe('[string | null, number | null]');
    });

    it('handles Tuple with many elements', () => {
      expect(clickhouseToTsType('Tuple(String, Int32, Float64, Bool, DateTime)')).toBe(
        '[string, number, number, boolean, string]'
      );
    });

    it('handles nested Tuple(String, Tuple(Int32, Int32))', () => {
      expect(clickhouseToTsType('Tuple(String, Tuple(Int32, Int32))')).toBe('[string, [number, number]]');
    });

    it('handles Array(Tuple(String, Int32))', () => {
      expect(clickhouseToTsType('Array(Tuple(String, Int32))')).toBe('Array<[string, number]>');
    });

    it('handles Nullable(Tuple(String, Int32))', () => {
      expect(clickhouseToTsType('Nullable(Tuple(String, Int32))')).toBe('[string, number] | null');
    });
  });

  describe('Map Types with Nullable Values', () => {
    it('handles Map(String, String)', () => {
      expect(clickhouseToTsType('Map(String, String)')).toBe('Record<string, string>');
    });

    it('handles Map(String, Nullable(String))', () => {
      expect(clickhouseToTsType('Map(String, Nullable(String))')).toBe('Record<string, string | null>');
    });

    it('handles Map(String, Nullable(Float64))', () => {
      expect(clickhouseToTsType('Map(String, Nullable(Float64))')).toBe('Record<string, number | null>');
    });

    it('handles Map(String, Array(String))', () => {
      expect(clickhouseToTsType('Map(String, Array(String))')).toBe('Record<string, Array<string>>');
    });

    it('handles Map(String, Array(Nullable(Int32)))', () => {
      expect(clickhouseToTsType('Map(String, Array(Nullable(Int32)))')).toBe('Record<string, Array<number | null>>');
    });

    it('handles Map(String, Tuple(String, Int32))', () => {
      expect(clickhouseToTsType('Map(String, Tuple(String, Int32))')).toBe('Record<string, [string, number]>');
    });

    it('handles Nullable(Map(String, String))', () => {
      expect(clickhouseToTsType('Nullable(Map(String, String))')).toBe('Record<string, string> | null');
    });

    it('handles Map(Int32, String) - numeric keys become strings', () => {
      expect(clickhouseToTsType('Map(Int32, String)')).toBe('Record<string, string>');
    });
  });

  describe('Nested Column Types (Deprecated but Still Used)', () => {
    it('handles Nested types gracefully', () => {
      // Nested is deprecated but still appears in legacy schemas
      // Parser should not crash on these
      const result = clickhouseToTsType('Nested(name String, value Int32)');
      expect(result).toBeTruthy(); // Should return something, not crash
    });
  });

  describe('SimpleAggregateFunction Types', () => {
    it('handles SimpleAggregateFunction(sum, Float64)', () => {
      const result = clickhouseToTsType('SimpleAggregateFunction(sum, Float64)');
      // These are used in AggregatingMergeTree tables
      expect(result).toBeTruthy(); // Should return something
    });

    it('handles SimpleAggregateFunction(max, DateTime)', () => {
      const result = clickhouseToTsType('SimpleAggregateFunction(max, DateTime)');
      expect(result).toBeTruthy();
    });
  });

  describe('AggregateFunction Types', () => {
    it('handles AggregateFunction(uniq, String)', () => {
      const result = clickhouseToTsType('AggregateFunction(uniq, String)');
      // These are used in AggregatingMergeTree tables
      expect(result).toBeTruthy();
    });

    it('handles AggregateFunction(quantile(0.95), Float64)', () => {
      const result = clickhouseToTsType('AggregateFunction(quantile(0.95), Float64)');
      expect(result).toBeTruthy();
    });
  });

  describe('IPv4 and IPv6 Types', () => {
    it('handles IPv4', () => {
      expect(clickhouseToTsType('IPv4')).toBe('string');
    });

    it('handles IPv6', () => {
      expect(clickhouseToTsType('IPv6')).toBe('string');
    });

    it('handles Nullable(IPv4)', () => {
      expect(clickhouseToTsType('Nullable(IPv4)')).toBe('string | null');
    });

    it('handles Array(IPv6)', () => {
      expect(clickhouseToTsType('Array(IPv6)')).toBe('Array<string>');
    });
  });

  describe('UUID Type', () => {
    it('handles UUID', () => {
      expect(clickhouseToTsType('UUID')).toBe('string');
    });

    it('handles Nullable(UUID)', () => {
      expect(clickhouseToTsType('Nullable(UUID)')).toBe('string | null');
    });

    it('handles Array(UUID)', () => {
      expect(clickhouseToTsType('Array(UUID)')).toBe('Array<string>');
    });
  });

  describe('Date32 Type', () => {
    it('handles Date32', () => {
      expect(clickhouseToTsType('Date32')).toBe('string');
    });

    it('handles Nullable(Date32)', () => {
      expect(clickhouseToTsType('Nullable(Date32)')).toBe('string | null');
    });
  });

  describe('Boolean Types', () => {
    it('handles Bool', () => {
      expect(clickhouseToTsType('Bool')).toBe('boolean');
    });

    it('handles Boolean', () => {
      expect(clickhouseToTsType('Boolean')).toBe('boolean');
    });

    it('handles Nullable(Bool)', () => {
      expect(clickhouseToTsType('Nullable(Bool)')).toBe('boolean | null');
    });

    it('handles Array(Bool)', () => {
      expect(clickhouseToTsType('Array(Bool)')).toBe('Array<boolean>');
    });
  });

  describe('JSON Type', () => {
    it('handles JSON', () => {
      expect(clickhouseToTsType('JSON')).toBe('unknown');
    });

    it('handles Nullable(JSON)', () => {
      expect(clickhouseToTsType('Nullable(JSON)')).toBe('unknown | null');
    });
  });

  describe('Real-World Complex Type Combinations', () => {
    it('handles Map(String, Nullable(Array(Tuple(String, Int32))))', () => {
      // Extremely nested - real schemas have these
      expect(clickhouseToTsType('Map(String, Nullable(Array(Tuple(String, Int32))))')).toBe(
        'Record<string, Array<[string, number]> | null>'
      );
    });

    it('handles Array(Tuple(String, Map(String, Nullable(Int32))))', () => {
      expect(clickhouseToTsType('Array(Tuple(String, Map(String, Nullable(Int32))))')).toBe(
        'Array<[string, Record<string, number | null>]>'
      );
    });

    it('handles Nullable(LowCardinality(Nullable(FixedString(2)))) - double nullable', () => {
      // Shouldn't happen but parser must handle
      expect(clickhouseToTsType('Nullable(LowCardinality(Nullable(FixedString(2))))')).toBe('string | null | null');
    });

    it('handles Array(LowCardinality(Nullable(Enum8(\'a\' = 1, \'b\' = 2))))', () => {
      expect(clickhouseToTsType("Array(LowCardinality(Nullable(Enum8('a' = 1, 'b' = 2))))")).toBe(
        'Array<string | null>'
      );
    });

    it('handles Map(FixedString(2), Tuple(DateTime64(3, \'UTC\'), Nullable(Decimal(18, 4))))', () => {
      // Country code → (timestamp, nullable amount) - real analytics schema
      expect(clickhouseToTsType("Map(FixedString(2), Tuple(DateTime64(3, 'UTC'), Nullable(Decimal(18, 4))))")).toBe(
        'Record<string, [string, number | null]>'
      );
    });
  });

  describe('Case Insensitivity', () => {
    it('handles lowercase type names', () => {
      expect(clickhouseToTsType('string')).toBe('string');
      expect(clickhouseToTsType('int32')).toBe('number');
      expect(clickhouseToTsType('float64')).toBe('number');
    });

    it('handles mixed-case type names', () => {
      expect(clickhouseToTsType('String')).toBe('string');
      expect(clickhouseToTsType('INT32')).toBe('number');
      expect(clickhouseToTsType('FLOAT64')).toBe('number');
    });

    it('handles mixed-case wrapper types', () => {
      expect(clickhouseToTsType('NULLABLE(String)')).toBe('string | null');
      expect(clickhouseToTsType('nullable(String)')).toBe('string | null');
      expect(clickhouseToTsType('ARRAY(Int32)')).toBe('Array<number>');
    });
  });

  describe('Edge Cases - Whitespace and Formatting', () => {
    it('handles types with extra whitespace', () => {
      expect(clickhouseToTsType('Nullable( String )')).toBe('string | null');
      expect(clickhouseToTsType('Array( Int32 )')).toBe('Array<number>');
    });

    it('handles Tuple with whitespace', () => {
      expect(clickhouseToTsType('Tuple( String , Int32 )')).toBe('[string, number]');
    });

    it('handles Map with whitespace', () => {
      expect(clickhouseToTsType('Map( String , Int32 )')).toBe('Record<string, number>');
    });
  });

  describe('Unknown or Unsupported Types Fallback', () => {
    it('returns string for completely unknown types', () => {
      expect(clickhouseToTsType('SomeWeirdCustomType')).toBe('string');
    });

    it('returns string for future ClickHouse types we don\'t know yet', () => {
      expect(clickhouseToTsType('FutureClickHouseType(arg1, arg2)')).toBe('string');
    });

    it('handles Nullable(UnknownType) gracefully', () => {
      expect(clickhouseToTsType('Nullable(UnknownType)')).toBe('string | null');
    });

    it('handles Array(UnknownType) gracefully', () => {
      expect(clickhouseToTsType('Array(UnknownType)')).toBe('Array<string>');
    });
  });
});
