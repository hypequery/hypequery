import { describe, expect, it } from 'vitest';
import { formatCents, formatDate, formatDateTime, utcSeconds } from './format.js';

describe('format', () => {
  it('formats UTC timestamps the way ClickHouse parses them', () => {
    const t = utcSeconds(2026, 3, 9, 7) + 65;
    expect(formatDateTime(t)).toBe('2026-03-09 07:01:05');
    expect(formatDate(t)).toBe('2026-03-09');
  });

  it('formats cents as Decimal(12, 2) literals', () => {
    expect(formatCents(4900)).toBe('49.00');
    expect(formatCents(199005)).toBe('1990.05');
    expect(formatCents(7)).toBe('0.07');
  });
});
