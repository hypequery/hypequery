import { describe, expect, it } from 'vitest';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { createDatasetClient, dataset, dimension, measure, buildDatasetInputSchema, buildMetricInputSchema } from './index.js';

const Events = dataset('events', {
  source: 'events', timeKey: 'time',
  dimensions: { time: dimension.timestamp({ column: 'event_at' }) },
  filters: { range: { field: 'time' } },
  measures: { revenue: measure.sum('amount') },
});
const queryBuilder = createQueryBuilder({ host: 'http://localhost:8123' });

describe('public execution timezone', () => {
  it('uses UTC by default and applies client defaults and query overrides to SQL and validation', () => {
    const utc = createDatasetClient({ queryBuilder });
    const tokyo = createDatasetClient({ queryBuilder, timezone: 'Asia/Tokyo' });
    const query = { by: 'day' as const, filters: [{ field: 'range', operator: 'gte' as const, value: '2026-01-02' }] };
    expect(utc.toSQL(Events, query)).toContain("toDateTime64(event_at, 9, 'UTC')");
    expect(tokyo.toSQL(Events, query)).toContain("toDateTime64(event_at, 9, 'Asia/Tokyo')");
    expect(tokyo.toSQL(Events, { ...query, timezone: 'America/New_York' }))
      .toContain("toDateTime64(event_at, 9, 'America/New_York')");
    expect(tokyo.toSQL(Events.metric('revenue', { measure: 'revenue' }).by('day'), { timezone: 'UTC' }))
      .toContain("toDateTime64(event_at, 9, 'UTC')");
    expect(tokyo.validate(Events, { ...query, timezone: 'Bad/Zone' }).valid).toBe(false);
    expect(query).not.toHaveProperty('timezone');
  });

  it.each(['', '+05:00', 'Bad/Zone', "UTC'); SELECT 1 --"])(
    'rejects invalid timezone %s at client construction, validation, and input schemas', timezone => {
      expect(() => createDatasetClient({ queryBuilder, timezone })).toThrow(/IANA/);
      const client = createDatasetClient({ queryBuilder });
      expect(client.validate(Events, { timezone }).valid).toBe(false);
      expect(() => client.toSQL(Events, { timezone })).toThrow(/IANA/);
      expect(buildDatasetInputSchema(Events).safeParse({ measures: ['revenue'], timezone }).success).toBe(false);
      expect(buildMetricInputSchema(Events, 'revenue').safeParse({ timezone }).success).toBe(false);
    },
  );

  it('rejects the removed metadata timezone API instead of silently accepting it', () => {
    expect(() => dimension.timestamp({ timezone: 'UTC' } as any)).toThrow(/not semantic metadata/);
    expect(() => dataset('invalid', { source: 'events', dimensions: {}, timezone: 'UTC' } as any)).toThrow(/not semantic metadata/);
  });
});
