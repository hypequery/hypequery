import { describe, expect, it } from 'vitest';
import {
  isIntegerLiteral,
  matchTypeCall,
  splitTopLevelArgs,
  unquoteClickHouseString,
  unwrapType,
} from './clickhouse-type-utils.js';

describe('clickhouse type utilities', () => {
  it('splits top-level arguments without splitting nested type calls', () => {
    expect(splitTopLevelArgs("String, Nullable(DateTime('UTC')), Decimal(10, 2)")).toEqual([
      'String',
      "Nullable(DateTime('UTC'))",
      'Decimal(10, 2)',
    ]);
  });

  it('unwraps matching type wrappers', () => {
    expect(unwrapType('Nullable(String)', 'Nullable')).toBe('String');
    expect(unwrapType('String', 'Nullable')).toBeNull();
  });

  it('matches type calls into arguments', () => {
    expect(matchTypeCall("DateTime64(3, 'UTC')", 'DateTime64')).toEqual(['3', "'UTC'"]);
  });

  it('unquotes ClickHouse string literal arguments', () => {
    expect(unquoteClickHouseString("'UTC'")).toBe('UTC');
    expect(unquoteClickHouseString('UTC')).toBe('UTC');
  });

  it('detects integer literals', () => {
    expect(isIntegerLiteral('3')).toBe(true);
    expect(isIntegerLiteral('3.5')).toBe(false);
  });
});
