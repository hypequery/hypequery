import { describe, expect, it } from 'vitest';
import { validateFilterValue } from './validation.js';

/**
 * ClickHouse reads an invalid DateTime64 parameter as another instant rather
 * than refusing it, so these must never be bound: `2026-13-45` became
 * 1900-01-01 (an all-time total for a `gte`), `2026-02-30` rolled into March,
 * and digits were read as Unix seconds. Same rule as the Python planner.
 */
describe('timestamp filter values', () => {
  const refused = [
    '2026-13-45',
    '2026-02-30',
    '2026-02-01 25:00:00',
    '2026-02-01 12:00',
    '2026-02-01T00:00Z',
    'yesterday',
    'not-a-date',
    '',
    '20260201',
    '1700000000',
    '2026-02-01T00:00:00+0000',
    '2026-01-31-05:30',
    '2026-01-31Z',
    '2026-02-01T00:00:00+05:60',
    '2026-02-01T00:00:00+24:00',
    '2026-02-01T24:00:00',
    '2026-02-01T12:60:00',
  ];
  it.each(refused)('refuses %j for comparison, between and in', value => {
    for (const filter of [
      { field: 'createdAt', operator: 'gte' as const, value },
      { field: 'createdAt', operator: 'eq' as const, value },
      { field: 'createdAt', operator: 'between' as const, value: [value, '2026-03-01'] },
      { field: 'createdAt', operator: 'in' as const, value: [value] },
    ]) {
      expect(validateFilterValue(filter, 'timestamp')).toMatch(/ISO 8601 timestamp.*"createdAt"/);
    }
  });

  it.each([
    '2026-02-01',
    '2026-02-01 12:00:00',
    '2026-02-01T12:00:00.123',
    '2026-02-01T12:00:00.123456789',
    '2026-02-01T00:00:00Z',
    '2026-02-01T00:00:00.000Z',
    '2026-02-01T10:00:00+10:00',
    '2026-02-01T10:00:00-05:30',
    '2024-02-29',
  ])('accepts %j', value => {
    expect(validateFilterValue({ field: 'createdAt', operator: 'gte', value }, 'timestamp')).toBeNull();
  });

  it('accepts Date#toISOString output', () => {
    const value = new Date('2026-02-01T00:00:00Z').toISOString();
    expect(validateFilterValue({ field: 'createdAt', operator: 'lt', value }, 'timestamp')).toBeNull();
  });

  it('leaves like patterns on timestamp fields alone', () => {
    expect(validateFilterValue({ field: 'createdAt', operator: 'like', value: '2026-02-%' }, 'timestamp')).toBeNull();
  });
});

describe('number filter values', () => {
  it.each([2 ** 53 + 2, -(2 ** 53) - 2, 1e300])('refuses %d, which Float64 cannot compare exactly as an integer', value => {
    for (const filter of [
      { field: 'id', operator: 'eq' as const, value },
      { field: 'id', operator: 'in' as const, value: [1, value] },
      { field: 'id', operator: 'between' as const, value: [0, value] },
    ]) {
      expect(validateFilterValue(filter, 'number')).toMatch(/safe integers.*dimension\.string/);
    }
  });

  it.each([Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 0, 1.5, 1e-300])('accepts %d', value => {
    expect(validateFilterValue({ field: 'id', operator: 'eq', value }, 'number')).toBeNull();
  });
});
