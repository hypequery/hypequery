import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { buildProtocolDatasetContract } from './protocol-adapter.js';
import { rehydrateProtocolDeploymentContract } from './protocol-rehydrate.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

function sqlFactory(): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const select: string[] = [];
    const groupBy: string[] = [];
    const push = (part: string) => { select.push(part); return builder; };
    const builder = {
      select: (args: string | string[]) => { select.push(...(Array.isArray(args) ? args : [args])); return builder; },
      sum: (c: string, a?: string) => push(`SUM(${c}) AS ${a}`),
      count: (c: string, a?: string) => push(`COUNT(${c}) AS ${a}`),
      where: () => builder,
      groupBy: (args: string | string[]) => { groupBy.push(...(Array.isArray(args) ? args : [args])); return builder; },
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({
        sql: `SELECT ${select.join(', ')} FROM ${table}${groupBy.length ? ` GROUP BY ${groupBy.join(', ')}` : ''}`,
        parameters: [],
      }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return { table: createBuilder, rawQuery: async () => [] };
}

const Events = dataset('events', {
  source: 'events',
  timeKey: 'created_at',
  dimensions: {
    kind: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: { events: measure.count('id') },
});

const DailyOnly = dataset('daily', {
  source: 'daily',
  timeKey: 'day',
  timeGrains: ['day', 'month'],
  dimensions: { day: dimension.timestamp() },
  measures: { total: measure.sum('amount') },
});

describe('sub-day grains', () => {
  it('buckets by hour and minute on the query-builder path', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    expect(client.toSQL(Events, { measures: ['events'], by: 'hour' }))
      .toBe('SELECT toStartOfHour(created_at) AS period, COUNT(id) AS events FROM events GROUP BY period');
    const perMinute = Events.metric('eventsPerMinute', { measure: 'events' }).by('minute');
    expect(client.toSQL(perMinute)).toContain('toStartOfMinute(created_at) AS period');
  });

  it('buckets sub-day periods with their time of day in the in-memory backend', async () => {
    const client = createDatasetClient({
      backend: createInMemoryBackend({
        events: [
          { id: 1, kind: 'a', created_at: '2024-01-01T10:05:30Z' },
          { id: 2, kind: 'a', created_at: '2024-01-01T10:55:00Z' },
          { id: 3, kind: 'a', created_at: '2024-01-01T11:10:00Z' },
        ],
      }),
    });
    const hourly = await client.execute(Events, { measures: ['events'], by: 'hour' });
    expect(hourly.data).toEqual(expect.arrayContaining([
      { period: '2024-01-01 10:00:00', events: '2' },
      { period: '2024-01-01 11:00:00', events: '1' },
    ]));
    const minutely = await client.execute(Events, { measures: ['events'], by: 'minute' });
    expect(minutely.data.map(row => row.period)).toEqual(expect.arrayContaining([
      '2024-01-01 10:05:00', '2024-01-01 10:55:00', '2024-01-01 11:10:00',
    ]));
  });

  it('keeps offset-free ClickHouse timestamps in their wall-clock buckets', async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'Europe/Madrid';
    try {
      const client = createDatasetClient({
        backend: createInMemoryBackend({
          events: [{ id: 1, kind: 'a', created_at: '2024-07-01 10:05:30' }],
        }),
      });
      const hourly = await client.execute(Events, { measures: ['events'], by: 'hour' });
      const minutely = await client.execute(Events, { measures: ['events'], by: 'minute' });
      expect(hourly.data[0]?.period).toBe('2024-07-01 10:00:00');
      expect(minutely.data[0]?.period).toBe('2024-07-01 10:05:00');
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });

  it('advertises every grain by default', () => {
    expect(getDatasetCatalog(Events).supportedGrains)
      .toEqual(['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year']);
  });
});

describe('dataset timeGrains', () => {
  it('restricts the catalog, queries, and pinned metrics', () => {
    expect(getDatasetCatalog(DailyOnly).supportedGrains).toEqual(['day', 'month']);
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    expect(client.validate(DailyOnly, { measures: ['total'], by: 'hour' }).errors)
      .toContain('Unsupported time grain "hour". Supported: day, month');
    expect(client.validate(DailyOnly, { measures: ['total'], by: 'month' }).valid).toBe(true);
    const metric = DailyOnly.metric('dailyTotal', { measure: 'total' });
    expect(client.validate(metric, { by: 'week' }).errors)
      .toContain('Unsupported time grain "week". Supported: day, month');
    expect(() => metric.by('hour')).toThrow(/Cannot apply \.by\("hour"\) to metric "dailyTotal": Unsupported time grain "hour"/);
  });

  it('is validated when the dataset is defined', () => {
    const base = {
      source: 't',
      dimensions: { day: dimension.timestamp() },
      measures: { total: measure.sum('amount') },
    };
    expect(() => dataset('a', { ...base, timeGrains: ['day'] })).toThrow(/timeGrains.*requires the dataset to define timeKey/);
    expect(() => dataset('b', { ...base, timeKey: 'day', timeGrains: [] })).toThrow(/timeGrains.*non-empty/);
    expect(() => dataset('c', { ...base, timeKey: 'day', timeGrains: ['day', 'day'] })).toThrow(/duplicates/);
    expect(() => dataset('d', { ...base, timeKey: 'day', timeGrains: ['second' as never] }))
      .toThrow(/unsupported time grain "second"/);
    expect(() => dataset('e', { ...base, timeKey: 'day', timeGrains: ['month'], defaults: { timeGrain: 'day' } }))
      .toThrow(/defaults\.timeGrain.*not one of the dataset timeGrains/);
  });
});

describe('publishing sub-day grains', () => {
  it('refuses restrictions contract 2 cannot preserve across publication', () => {
    expect(() => buildProtocolDeploymentContract([DailyOnly]))
      .toThrow(/Dataset "daily" timeGrains excludes week, quarter, year.*cannot preserve dataset-level grain restrictions/);
  });

  it('publishes an explicit grain list when it includes every portable grain', () => {
    const PortableEvents = dataset('portableEvents', {
      source: 'events',
      timeKey: 'created_at',
      timeGrains: ['minute', 'hour', 'day', 'week', 'month', 'quarter', 'year'],
      dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }) },
      measures: { events: measure.count('id') },
    });
    const [published] = Object.values(rehydrateProtocolDeploymentContract(
      buildProtocolDeploymentContract([PortableEvents]),
    ));
    expect(getDatasetCatalog(published!).supportedGrains)
      .toEqual(['day', 'week', 'month', 'quarter', 'year']);
  });

  it('refuses a sub-day default grain with an actionable error', () => {
    const HourlyDefault = dataset('hourly', {
      source: 'events',
      timeKey: 'created_at',
      defaults: { timeGrain: 'hour' },
      dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }) },
      measures: { events: measure.count('id') },
    });
    expect(() => buildProtocolDeploymentContract([HourlyDefault]))
      .toThrow(/Dataset "hourly" defaults\.timeGrain uses the "hour" time grain, which cannot be published yet/);
  });

  it('refuses a metric pinned to a sub-day grain and advertises only portable grains', () => {
    const endpoint = { access: { kind: 'public' }, tenant: { kind: 'not-required' } } as const;
    expect(() => buildProtocolDatasetContract(Events, {
      metrics: { perMinute: Events.metric('perMinute', { measure: 'events' }).by('minute') },
      metricEndpoints: { perMinute: endpoint },
    })).toThrow(/Metric "perMinute" uses the "minute" time grain/);

    const contract = buildProtocolDatasetContract(Events, {
      metrics: { total: Events.metric('total', { measure: 'events' }) },
      metricEndpoints: { total: endpoint },
    });
    expect(contract.metrics[0]!.grains).toEqual(['day', 'month', 'quarter', 'week', 'year']);
  });

  it('keeps rehydrated datasets to the grains the published contract carries', () => {
    const [published] = Object.values(rehydrateProtocolDeploymentContract(
      buildProtocolDeploymentContract([Events]),
    ));
    expect(getDatasetCatalog(published!).supportedGrains).toEqual(['day', 'week', 'month', 'quarter', 'year']);
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    expect(client.validate(published!, { measures: ['events'], by: 'hour' }).valid).toBe(false);
  });
});
