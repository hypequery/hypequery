import { describe, expect, it } from 'vitest';
import { resultValueTypes } from './result-values.js';

const parse = (oid: number, text: string) => resultValueTypes.getTypeParser(oid, 'text')(text);

describe('Postgres result values', () => {
  it('keeps 64-bit integers as strings and parses other numbers', () => {
    expect(parse(20, '9007199254740993')).toBe('9007199254740993');
    expect(parse(23, '42')).toBe(42);
    expect(parse(1700, '12.50')).toBe(12.5);
    expect(parse(701, 'NaN')).toBeNaN();
  });

  it('returns timestamps and dates as wall-clock text', () => {
    expect(parse(1114, '2026-01-02 10:05:00')).toBe('2026-01-02 10:05:00');
    expect(parse(1082, '2025-12-28')).toBe('2025-12-28');
    expect(parse(1184, '2026-01-02 10:05:07.123+00')).toBe('2026-01-02 10:05:07.123');
  });

  it('parses booleans and JSON, and leaves other types as text', () => {
    expect(parse(16, 't')).toBe(true);
    expect(parse(3802, '{"a":1}')).toEqual({ a: 1 });
    expect(parse(25, 'x')).toBe('x');
  });

  it('refuses binary results', () => {
    expect(() => resultValueTypes.getTypeParser(23, 'binary')).toThrow();
  });
});
