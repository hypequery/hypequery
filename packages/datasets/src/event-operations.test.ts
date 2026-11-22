import { describe, expect, it } from 'vitest';
import { validateProtocolDeploymentContract, validateProtocolEventOperation } from '@hypequery/protocol';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset, dimension, measure } from './index.js';
import { eventOperationErrors, prepareEventOperation } from './event-operations.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { eventOperationSpec, type FunnelSpec } from './utils/event-operation-spec.js';
import { funnelResultRows } from './utils/funnel-rows.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';
import { createPortableSemanticRuntime } from './portable-executor.js';

const Activity = dataset('activity', {
  source: 'analytics.activity',
  tenantKey: 'tenantId',
  timeKey: 'occurredAt',
  events: { entity: 'userId', event: 'eventName' },
  dimensions: {
    userId: dimension.string({ column: 'user_id' }),
    eventName: dimension.string({ column: 'event' }),
    plan: dimension.string(),
    secret: dimension.string({ filterable: false, groupable: false }),
    occurredAt: dimension.timestamp({ column: 'at' }),
  },
  measures: { events: measure.count('userId') },
});

const RANGE = { field: 'occurredAt', operator: 'between', value: ['2026-10-01', '2026-11-01'] } as const;

function spec(overrides: Partial<FunnelSpec> = {}): FunnelSpec {
  return {
    kind: 'funnel',
    entity: 'userId',
    steps: [
      { name: 'signed_up', where: [{ field: 'eventName', operator: 'eq', value: "signup'); DROP TABLE x; --" }] },
      { name: 'queried', where: [{ field: 'eventName', operator: 'in', value: ['query', 'export'] }] },
    ],
    windowMs: 7 * 86_400_000,
    order: 'strict',
    filters: [RANGE],
    breakdown: [],
    breakdownLimit: 25,
    ...overrides,
  };
}

function capturingFactory(rows: Record<string, unknown>[] = []) {
  const db = createQueryBuilder({ host: 'http://localhost:8123' });
  const calls: { sql: string; parameters: unknown[] }[] = [];
  const factory = {
    table: (name: string) => db.table(name as never),
    rawQuery: async (sql: string, parameters: unknown[] = []) => {
      calls.push({ sql, parameters });
      return rows;
    },
  } as unknown as QueryBuilderFactoryLike;
  return { factory, calls };
}

const context = { runtime: { tenant: 'acme' } };

describe('event datasets (RFC 0027)', () => {
  it('publishes events and rehydrates them unchanged', () => {
    const contract = buildProtocolDeploymentContract([Activity], {
      endpoints: { activity: { access: { kind: 'public' }, tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' } } },
    });
    const published = validateProtocolDeploymentContract(contract).datasets[0]!;
    expect(published.events).toEqual({ entity: 'userId', event: 'eventName' });
    expect(published.timeField).toBe('occurredAt');
    expect(rehydrateProtocolDatasets(contract.datasets).activity!.events).toEqual({ entity: 'userId', event: 'eventName' });
  });

  it('refuses an events declaration the contract would refuse', () => {
    const base = {
      source: 'activity', timeKey: 'at',
      dimensions: { userId: dimension.string(), at: dimension.timestamp(), score: dimension.number({ groupable: false }) },
    };
    expect(() => dataset('a', { ...base, events: { entity: 'missing' } })).toThrow(/events.entity "missing" must name a dimension/);
    expect(() => dataset('a', { ...base, events: { entity: 'at' } })).toThrow(/groupable string or number/);
    expect(() => dataset('a', { ...base, events: { entity: 'score' } })).toThrow(/groupable string or number/);
    expect(() => dataset('a', { ...base, events: { entity: 'userId', event: 'score' } })).toThrow(/filterable string/);
    expect(() => dataset('a', { ...base, timeKey: undefined, events: { entity: 'userId' } })).toThrow(/timeKey naming a timestamp/);
    expect(() => dataset('a', { ...base, events: { entity: 'userId', time: 'at' } as never })).toThrow(/events.time is not supported/);
  });
});

describe('funnel planning (RFC 0027)', () => {
  it('binds every caller value and scopes the scan to the tenant', () => {
    const { factory } = capturingFactory();
    const prepared = prepareEventOperation(Activity, spec(), { builderFactory: factory, context });
    const { sql, parameters } = prepared.statement;
    expect(sql).not.toContain('DROP TABLE');
    expect(parameters).toEqual(expect.arrayContaining(["signup'); DROP TABLE x; --", 'query', 'export', 'acme']));
    expect(sql).toContain('WHERE analytics.activity.tenantId = ?');
    expect(sql).toContain("windowFunnel(1814400000, 'strict_increase')");
    expect(sql).toContain('toUnixTimestamp64Milli(_hq_time) * 3 + (2 - _hq_j)');
  });

  it('runs the statement and expands one row per step', async () => {
    const { factory, calls } = capturingFactory([{ _hq_r1: '10', _hq_r2: 4 }]);
    const rows = await prepareEventOperation(Activity, spec(), { builderFactory: factory, context }).execute();
    expect(calls).toHaveLength(1);
    expect(rows).toEqual([
      { step: 'signed_up', step_index: 1, entities: 10, conversion_from_previous: 1, conversion_from_first: 1, dropoff: 0 },
      { step: 'queried', step_index: 2, entities: 4, conversion_from_previous: 0.4, conversion_from_first: 0.4, dropoff: 6 },
    ]);
  });

  it('plans any order, breakdown ranking and cohorts', () => {
    const { factory } = capturingFactory();
    const { sql } = prepareEventOperation(Activity, spec({ order: 'any', breakdown: ['plan'], breakdownLimit: 5, by: 'week' }), {
      builderFactory: factory, context,
    }).statement;
    expect(sql).not.toContain('windowFunnel');
    expect(sql).toContain('arrayMax(arrayMap(_hq_t ->');
    expect(sql).toContain('dense_rank() OVER (ORDER BY _hq_size DESC, _hq_b0 ASC NULLS LAST)');
    expect(sql).toContain('_hq_rank <= 5');
    expect(sql).toContain("formatDateTime(toStartOfWeek(_hq_first), '%Y-%m-%d') AS _hq_cohort");
  });

  it('refuses what the data plane refuses, in case it is called directly', () => {
    expect(eventOperationErrors(Activity, spec({ filters: [] }), context).join(' ')).toMatch(/bounded time range/);
    expect(eventOperationErrors(Activity, spec({
      filters: [{ field: 'occurredAt', operator: 'gte', value: '2026-10-01' }],
    }), context).join(' ')).toMatch(/bounded time range/);
    expect(eventOperationErrors(Activity, spec({
      steps: [
        { name: 'a', where: [{ field: 'occurredAt', operator: 'gte', value: '2026-10-02' }] },
        { name: 'b', where: [{ field: 'eventName', operator: 'eq', value: 'x' }] },
      ],
    }), context).join(' ')).toMatch(/may not use "occurredAt"/);
    expect(eventOperationErrors(Activity, spec({ entity: 'secret' }), context).length).toBeGreaterThan(0);
    expect(eventOperationErrors(Activity, spec({ breakdown: ['occurredAt'] }), context).join(' ')).toMatch(/time dimension/);
    expect(eventOperationErrors(Activity, spec({
      steps: [{ name: 'a', where: [{ field: 'secret', operator: 'eq', value: 'x' }] }, spec().steps[1]!],
    }), context).length).toBeGreaterThan(0);
    // A tenant-scoped dataset without a tenant is refused like a dataset query.
    expect(eventOperationErrors(Activity, spec(), {}).length).toBeGreaterThan(0);
    expect(() => prepareEventOperation(Activity, spec({ filters: [] }), { builderFactory: capturingFactory().factory, context }))
      .toThrow(/Invalid funnel/);
  });

  it('resolves a protocol operation with the dataset default entity', () => {
    const operation = validateProtocolEventOperation({
      kind: 'funnel', dataset: 'activity', window: '2 hour',
      steps: [
        { name: 'a', where: [{ kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'eventName' }, right: { kind: 'literal', value: 'x' } }] },
        { name: 'b', where: [{ kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'eventName' }, right: { kind: 'literal', value: 'y' } }] },
      ],
      filters: [{
        kind: 'comparison', operator: 'between', left: { kind: 'reference', name: 'occurredAt' },
        right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-10-01', '2026-11-01'] } } },
      }],
    });
    const resolved = eventOperationSpec(operation, Activity);
    expect(resolved).toMatchObject({ entity: 'userId', windowMs: 7_200_000, order: 'strict', breakdownLimit: 25 });
    expect(resolved.filters).toEqual([{ field: 'occurredAt', operator: 'between', value: ['2026-10-01', '2026-11-01'] }]);
  });
});

describe('funnel result rows', () => {
  it('reports null conversions for empty denominators and keeps group columns first', () => {
    const rows = funnelResultRows(spec({ breakdown: ['plan'], by: 'day' }), ['_hq_b0'], [
      { _hq_cohort: '2026-10-04', _hq_b0: null, _hq_r1: 0, _hq_r2: 0 },
    ]);
    expect(rows).toEqual([
      { cohort: '2026-10-04', plan: null, step: 'signed_up', step_index: 1, entities: 0, conversion_from_previous: null, conversion_from_first: null, dropoff: 0 },
      { cohort: '2026-10-04', plan: null, step: 'queried', step_index: 2, entities: 0, conversion_from_previous: null, conversion_from_first: null, dropoff: 0 },
    ]);
    expect(Object.keys(rows[0]!)).toEqual([
      'cohort', 'plan', 'step', 'step_index', 'entities', 'conversion_from_previous', 'conversion_from_first', 'dropoff',
    ]);
  });

  it('refuses a count that is not a non-negative integer', () => {
    expect(() => funnelResultRows(spec(), [], [{ _hq_r1: -1, _hq_r2: 0 }])).toThrow(/non-negative integer/);
  });
});

describe('review regressions (RFC 0027)', () => {
  const Received = dataset('received', {
    source: 'analytics.received',
    tenantKey: 'tenantId',
    timeKey: 'occurredAt',
    events: { entity: 'userId', event: 'eventName' },
    dimensions: {
      userId: dimension.string({ column: 'user_id' }),
      eventName: dimension.string({ column: 'event' }),
      step: dimension.string(),
      receivedAt: dimension.timestamp({ column: 'received_at' }),
      occurredAt: dimension.timestamp({ column: 'at' }),
    },
  });

  it('compares a timestamp step condition with an instant in UTC, like a caller filter', () => {
    const { factory } = capturingFactory();
    const { sql, parameters } = prepareEventOperation(Received, spec({
      steps: [
        { name: 'signed_up', where: [{ field: 'receivedAt', operator: 'gte', value: '2026-10-01T09:30:00+02:00' }] },
        { name: 'queried', where: [{ field: 'eventName', operator: 'eq', value: 'query' }] },
      ],
      timezone: 'America/New_York',
    }), { builderFactory: factory, context }).statement;
    expect(sql).toContain("toDateTime64(_hq_f0, 9, 'UTC') >= ?");
    expect(parameters).toContain('2026-10-01 07:30:00');
    expect(parameters).not.toContain('2026-10-01T09:30:00+02:00');
  });

  it('refuses a direct spec whose breakdown would overwrite an output column', () => {
    expect(eventOperationErrors(Received, spec({ breakdown: ['step'] }), context))
      .toEqual(['Breakdown dimension "step" collides with the "step" output column.']);
    const shape = eventOperationErrors(Received, spec({
      breakdown: ['eventName', 'eventName'], breakdownLimit: 0, windowMs: 0, by: 'hour' as never,
      steps: [{ name: 'a', where: [] }, { name: 'a', where: [{ field: 'eventName', operator: 'eq', value: 'x' }] }],
    }), context).join(' ');
    for (const message of [/must be unique/, /breakdownLimit must be/, /Step names must be unique/, /needs 1 to 10 conditions/, /window must be/, /not day, week or month/]) {
      expect(shape).toMatch(message);
    }
    expect(eventOperationErrors(Received, spec({ steps: [spec().steps[0]!] }), context).join(' ')).toMatch(/2 to 10 steps/);
    expect(eventOperationErrors(Received, spec({ breakdown: ['a', 'b', 'c', 'd'] }), context).join(' ')).toMatch(/At most 3 breakdown/);
  });

  it('applies enforced constraints as trusted context, not as a second caller range', async () => {
    const { factory, calls } = capturingFactory([{ _hq_r1: 1, _hq_r2: 0 }]);
    const deployment = buildProtocolDeploymentContract([Activity], {
      endpoints: { activity: { access: { kind: 'public' }, tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' } } },
    });
    const where = (value: string) => [{ kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'eventName' }, right: { kind: 'literal', value } }];
    const operation = validateProtocolEventOperation({
      kind: 'funnel', dataset: 'activity', window: '1 day',
      steps: [{ name: 'a', where: where('signup') }, { name: 'b', where: where('query') }],
      filters: [{
        kind: 'comparison', operator: 'between', left: { kind: 'reference', name: 'occurredAt' },
        right: { kind: 'literal', value: { $hypequery: { type: 'tuple', version: 1, values: ['2026-10-01', '2026-11-01'] } } },
      }],
    });
    const result = await createPortableSemanticRuntime({ queryBuilder: factory }).executeEventOperation({
      deployment, dataset: deployment.datasets[0]!, operation, tenant: 'acme',
      constraints: [{ kind: 'comparison', operator: 'gte', left: { kind: 'reference', name: 'occurredAt' }, right: { kind: 'literal', value: '2026-10-15' } }],
      budget: { maxRows: 100 }, activationRevision: 'c'.repeat(64),
    });
    expect(result.data[0]).toMatchObject({ step: 'a', entities: 1 });
    expect(calls[0]!.sql).toMatch(/toDateTime64\(analytics\.activity\.at, 9, 'UTC'\) >= \?/);
    expect(calls[0]!.parameters).toContain('2026-10-15');
  });
});

describe('RFC 0029 filters in funnels', () => {
  it('renders and/or/not step conditions as written, with bound values', () => {
    const { factory } = capturingFactory();
    const { sql, parameters } = prepareEventOperation(Activity, spec({
      steps: [
        { name: 'signed_up', where: [{ or: [
          { field: 'eventName', operator: 'eq', value: 'signup' },
          { field: 'eventName', operator: 'eq', value: 'sso' },
        ] }] },
        { name: 'queried', where: [{ not: { field: 'plan', operator: 'eq', value: 'free' } }] },
      ],
    }), { builderFactory: factory, context }).statement;
    expect(sql).toContain('toUInt8(ifNull((((_hq_f0 = ?)) OR ((_hq_f0 = ?))), 0))');
    expect(sql).toContain('toUInt8(ifNull((NOT ((_hq_f1 = ?))), 0))');
    expect(parameters).toEqual(expect.arrayContaining(['signup', 'sso', 'free']));
  });

  it('applies filter groups to the scan', () => {
    const { factory } = capturingFactory();
    const { sql } = prepareEventOperation(Activity, spec({
      filters: [RANGE, { or: [
        { field: 'plan', operator: 'eq', value: 'pro' },
        { field: 'plan', operator: 'eq', value: 'team' },
      ] }],
    }), { builderFactory: factory, context }).statement;
    expect(sql).toMatch(/\(analytics\.activity\.plan = \? OR analytics\.activity\.plan = \?\)/);
  });

  it('resolves a relative range against the clock and the operation zone', () => {
    const { factory } = capturingFactory();
    const now = () => new Date('2026-11-20T03:00:00Z');
    const { parameters } = prepareEventOperation(Activity, spec({
      filters: [{ field: 'occurredAt', operator: 'inDateRange', value: 'last 7 days' }],
      timezone: 'America/Los_Angeles',
    }), { builderFactory: factory, context, now }).statement;
    // 03:00 UTC on 20 November is still 19 November in Los Angeles.
    expect(parameters).toEqual(expect.arrayContaining(['2026-11-12', '2026-11-19']));
  });

  it('refuses a time range that only appears under "or"', () => {
    expect(eventOperationErrors(Activity, spec({
      filters: [{ or: [RANGE, { field: 'plan', operator: 'eq', value: 'pro' }] }],
    }), context).join(' ')).toMatch(/bounded time range on "occurredAt" as top-level filters/);
  });
});
