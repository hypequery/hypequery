import { describe, expect, it } from 'vitest';
import {
  assertValidIdentifier,
  quoteIdentifier,
  sqlDateTime,
  sqlString,
  sqlStringArray,
} from './clickhouse-sql.js';

describe('clickhouse sql helpers', () => {
  it('quotes safe identifiers', () => {
    expect(quoteIdentifier('_hypequery_migrations')).toBe('`_hypequery_migrations`');
  });

  it('rejects unsafe identifiers', () => {
    expect(() => assertValidIdentifier('system.tables')).toThrow('Invalid ClickHouse identifier');
  });

  it('escapes string literals', () => {
    expect(sqlString("can't\\stop")).toBe("'can\\'t\\\\stop'");
  });

  it('renders arrays and dates', () => {
    expect(sqlStringArray(['a', 'b'])).toBe("['a', 'b']");
    expect(sqlDateTime(new Date('2026-05-26T10:00:00.000Z')))
      .toBe("parseDateTime64BestEffort('2026-05-26T10:00:00.000Z', 3)");
  });
});
