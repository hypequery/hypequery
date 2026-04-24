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
});
