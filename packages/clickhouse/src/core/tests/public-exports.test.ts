import {
  toStartOfMinute,
  toStartOfHour,
  toStartOfDay,
  toStartOfWeek,
  toStartOfMonth,
  toStartOfQuarter,
  toStartOfYear,
} from '../../index.js';

describe('Public exports', () => {
  it('exports built-in ClickHouse start-of interval helpers from the package entrypoint', () => {
    expect(toStartOfMinute('created_at').toSql()).toBe('toStartOfMinute(created_at)');
    expect(toStartOfHour('created_at').toSql()).toBe('toStartOfHour(created_at)');
    expect(toStartOfDay('created_at').toSql()).toBe('toStartOfDay(created_at)');
    expect(toStartOfWeek('created_at').toSql()).toBe('toStartOfWeek(created_at, 1)');
    expect(toStartOfMonth('created_at').toSql()).toBe('toStartOfMonth(created_at)');
    expect(toStartOfQuarter('created_at').toSql()).toBe('toStartOfQuarter(created_at)');
    expect(toStartOfYear('created_at').toSql()).toBe('toStartOfYear(created_at)');
  });
});
