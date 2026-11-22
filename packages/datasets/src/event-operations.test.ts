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
