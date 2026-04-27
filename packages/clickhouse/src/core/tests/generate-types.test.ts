import { describe, expect, it } from 'vitest';
import { clickhouseToTsType } from '../../cli/generate-types.js';

describe('clickhouseToTsType', () => {
  it('maps 64-bit and wider integers to string', () => {
    expect(clickhouseToTsType('UInt64')).toBe('string');
    expect(clickhouseToTsType('Int64')).toBe('string');
    expect(clickhouseToTsType('UInt128')).toBe('string');
    expect(clickhouseToTsType('Int256')).toBe('string');
  });

  it('keeps 32-bit and smaller integers as number', () => {
    expect(clickhouseToTsType('UInt32')).toBe('number');
    expect(clickhouseToTsType('Int32')).toBe('number');
  });

  it('propagates wide integer mapping through nested types', () => {
    expect(clickhouseToTsType('Array(UInt64)')).toBe('Array<string>');
    expect(clickhouseToTsType('Nullable(Int128)')).toBe('string | null');
    expect(clickhouseToTsType('Map(String, UInt64)')).toBe('Record<string, string>');
  });

  it('renders map keys as strings for numeric ClickHouse maps', () => {
    expect(clickhouseToTsType('Map(UInt64, String)')).toBe('Record<string, string>');
    expect(clickhouseToTsType('Map(UInt32, UInt64)')).toBe('Record<string, string>');
  });

  it('renders tuple types positionally', () => {
    expect(
      clickhouseToTsType('Tuple(UInt32, LowCardinality(String), String, String, LowCardinality(String))')
    ).toBe('[number, string, string, string, string]');
    expect(
      clickhouseToTsType('Array(Tuple(UInt32, LowCardinality(String), String, String, LowCardinality(String)))')
    ).toBe('Array<[number, string, string, string, string]>');
  });

  it('handles nested tuple values inside maps and nullable wrappers', () => {
    expect(
      clickhouseToTsType('Map(String, Tuple(UInt64, Nullable(String)))')
    ).toBe('Record<string, [string, string | null]>');
    expect(
      clickhouseToTsType('LowCardinality(Nullable(String))')
    ).toBe('string | null');
    expect(
      clickhouseToTsType('Nullable(Array(Tuple(UInt32, String)))')
    ).toBe('Array<[number, string]> | null');
    expect(
      clickhouseToTsType('Map(String, Array(Tuple(UInt32, String)))')
    ).toBe('Record<string, Array<[number, string]>>');
  });
});
