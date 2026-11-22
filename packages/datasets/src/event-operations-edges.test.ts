/**
 * Edge paths of the RFC 0027 planner that the ClickHouse suites can't reach
 * through valid operations: every condition operator, refusals for inputs
 * the data plane already rejects, and defensive guards on internal helpers.
 */
import { describe, expect, it } from 'vitest';
import type { ProtocolEventOperation } from '@hypequery/protocol';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import { dataset, dimension, measure } from './index.js';
import { eventOperationErrors, prepareEventOperation } from './event-operations.js';
import { PortableExecutionUnsupportedError } from './portable-execution-errors.js';
import { datasetEventsErrors } from './utils/dataset-events.js';
import { eventConditionFlagSql, eventConditionSql } from './utils/event-condition-sql.js';
import { eventOperationSpec, type FunnelSpec } from './utils/event-operation-spec.js';
import { buildEventSourceSql } from './utils/event-source-sql.js';
import { funnelResultRows } from './utils/funnel-rows.js';
import { StatementParameters } from './utils/statement-parameters.js';
import { clickhouseDatasetSqlDialect } from './utils/clickhouse-dataset-sql-dialect.js';
import type { MetricFilter } from './types.js';
import type { QueryBuilderFactoryLike } from './query-builder-protocol.js';

const Activity = dataset('activity', {
  source: 'analytics.activity',
  timeKey: 'occurredAt',
  events: { entity: 'userId', event: 'eventName' },
  dimensions: {
    userId: dimension.string({ column: 'user_id' }),
    eventName: dimension.string({ column: 'event' }),
    plan: dimension.string(),
    occurredAt: dimension.timestamp({ column: 'at' }),
  },
  measures: { events: measure.count('userId') },
});

const Plain = dataset('plain', {
  source: 'analytics.plain',
  timeKey: 'occurredAt',
  dimensions: { userId: dimension.string(), occurredAt: dimension.timestamp() },
  measures: { rows: measure.count('userId') },
});

const RANGE = { field: 'occurredAt', operator: 'between', value: ['2026-10-01', '2026-11-01'] } as const;

function spec(overrides: Partial<FunnelSpec> = {}): FunnelSpec {
  return {
    kind: 'funnel',
    entity: 'userId',
    steps: [
      { name: 'a', where: [{ field: 'eventName', operator: 'eq', value: 'signup' }] },
      { name: 'b', where: [{ field: 'eventName', operator: 'eq', value: 'query' }] },
    ],
    windowMs: 60_000,
    order: 'strict',
    filters: [RANGE],
    breakdown: [],
    breakdownLimit: 25,
    ...overrides,
  };
}

function factory(extra: Record<string, unknown> = {}): QueryBuilderFactoryLike {
  const db = createQueryBuilder({ host: 'http://localhost:8123' });
  return {
    table: (name: string) => db.table(name as never),
    rawQuery: async () => [],
    ...extra,
  } as unknown as QueryBuilderFactoryLike;
}

describe('event condition SQL', () => {
  const render = (filter: MetricFilter) => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const text = eventConditionSql('_hq_f0', filter, statement);
    return statement.render(text);
  };

  it.each([
    [{ field: 'x', operator: 'eq', value: 'a' }, '_hq_f0 = ?', ['a']],
    [{ field: 'x', operator: 'neq', value: 'a' }, '_hq_f0 != ?', ['a']],
    [{ field: 'x', operator: 'gt', value: 1 }, '_hq_f0 > ?', [1]],
    [{ field: 'x', operator: 'gte', value: 1 }, '_hq_f0 >= ?', [1]],
    [{ field: 'x', operator: 'lt', value: 1 }, '_hq_f0 < ?', [1]],
    [{ field: 'x', operator: 'lte', value: 1 }, '_hq_f0 <= ?', [1]],
    [{ field: 'x', operator: 'like', value: '%a%' }, '_hq_f0 LIKE ?', ['%a%']],
    [{ field: 'x', operator: 'isNull' }, '_hq_f0 IS NULL', []],
    [{ field: 'x', operator: 'isNotNull' }, '_hq_f0 IS NOT NULL', []],
    [{ field: 'x', operator: 'in', value: ['a', 'b'] }, '_hq_f0 IN (?, ?)', ['a', 'b']],
    [{ field: 'x', operator: 'notIn', value: ['a'] }, '_hq_f0 NOT IN (?)', ['a']],
    [{ field: 'x', operator: 'between', value: [1, 2] }, '_hq_f0 BETWEEN ? AND ?', [1, 2]],
  ] as [MetricFilter, string, unknown[]][])('renders %j with bound values', (filter, sql, parameters) => {
    expect(render(filter)).toEqual({ sql, parameters });
  });

  it('refuses malformed list and range values', () => {
    expect(() => render({ field: 'x', operator: 'in', value: [] })).toThrow(/non-empty array/);
    expect(() => render({ field: 'x', operator: 'notIn', value: 'a' })).toThrow(/non-empty array/);
    expect(() => render({ field: 'x', operator: 'between', value: [1] })).toThrow(/two-item array/);
  });

  it('ANDs conditions into a non-null flag', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const text = eventConditionFlagSql([
      { field: 'x', operator: 'eq', value: 'a' },
      { field: 'y', operator: 'isNotNull' },
    ], condition => [{ expression: `_c_${condition.field}`, operator: condition.operator, value: condition.value }], statement);
    expect(statement.render(text).sql).toBe('toUInt8(ifNull((_c_x = ?) AND (_c_y IS NOT NULL), 0))');
  });
});

describe('events declaration', () => {
  const dimensions = { userId: dimension.string(), at: dimension.timestamp() };

  it('refuses a non-object declaration and an unknown event dimension', () => {
    expect(datasetEventsErrors({ timeKey: 'at', dimensions, events: 'userId' as never }))
      .toEqual(['events must be an object with an entity dimension.']);
    expect(datasetEventsErrors({ timeKey: 'at', dimensions, events: { entity: 'userId', event: 'kind' } }))
      .toEqual(['events.event "kind" must name a dimension.']);
    expect(datasetEventsErrors({ timeKey: 'at', dimensions })).toEqual([]);
  });
});

describe('event operation refusals', () => {
  it('refuses a dataset without events and an empty range', () => {
    expect(eventOperationErrors(Plain, spec())).toEqual(['Dataset "plain" does not declare events.']);
    expect(eventOperationErrors(Activity, spec({
      filters: [{ field: 'occurredAt', operator: 'between', value: ['2026-11-01', '2026-10-01'] }],
    }))).toContain('The time range must be non-empty and ordered.');
  });

  it('refuses a dialect that is not ClickHouse', () => {
    const other = factory({ datasetSqlDialect: { name: 'other-engine' } });
    expect(() => prepareEventOperation(Activity, spec(), { builderFactory: other }))
      .toThrow(/need(s)? ClickHouse; the "other-engine" datasets dialect/);
  });

  it('resolves only operations it can plan', () => {
    const operation = {
      kind: 'funnel', dataset: 'plain', window: '7 day', filters: [],
      steps: [{ name: 'a', where: [] }, { name: 'b', where: [] }],
    } as unknown as ProtocolEventOperation;
    expect(() => eventOperationSpec(operation, Plain)).toThrow(/does not declare events/);
    expect(() => eventOperationSpec({ ...operation, dataset: 'activity', window: '7 days' } as never, Activity))
      .toThrow(/Invalid funnel window "7 days"/);
    const logical = {
      kind: 'logical', operator: 'or',
      operands: [
        { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'plan' }, right: { kind: 'literal', value: 'a' } },
        { kind: 'comparison', operator: 'eq', left: { kind: 'reference', name: 'plan' }, right: { kind: 'literal', value: 'b' } },
      ],
    };
    expect(() => eventOperationSpec({ ...operation, dataset: 'activity', filters: [logical] } as never, Activity))
      .toThrow(PortableExecutionUnsupportedError);
  });
});

describe('event source SQL', () => {
  const request = { entity: 'userId', breakdown: [], conditionFields: ['eventName'], filters: [RANGE] };

  it('needs a time key and only resolves projected condition fields', () => {
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const untimed = { ...Activity, timeKey: undefined } as never;
    expect(() => buildEventSourceSql(untimed, request, { builderFactory: factory() }, statement))
      .toThrow(/has no time key for events/);
    const source = buildEventSourceSql(Activity, request, { builderFactory: factory() }, statement);
    expect(source.conditionColumn('eventName')).toBe('_hq_f0');
    expect(() => source.conditionColumn('plan')).toThrow(/was not projected/);
  });

  it('picks a row alias no authored identifier contains', () => {
    const Clashing = dataset('clashing', {
      source: 'analytics.clashing',
      timeKey: 'occurredAt',
      events: { entity: 'userId' },
      dimensions: {
        userId: dimension.string({ column: '_hq_row' }),
        occurredAt: dimension.timestamp(),
      },
    });
    const statement = new StatementParameters(clickhouseDatasetSqlDialect);
    const source = buildEventSourceSql(Clashing, { ...request, conditionFields: [] }, { builderFactory: factory() }, statement);
    const sql = statement.render(source.ctes.join(', ')).sql;
    expect(sql).toContain('AS _hq_row_ FROM');
    expect(sql).toContain('tupleElement(_hq_row_, 2) AS _hq_entity');
  });
});

describe('funnel result cells', () => {
  it('normalizes breakdown values that are not plain scalars', () => {
    const rows = funnelResultRows(spec({ breakdown: ['plan', 'region', 'score'] }), ['_hq_b0', '_hq_b1', '_hq_b2'], [
      { _hq_b0: undefined, _hq_b1: 42n, _hq_b2: Number.NaN, _hq_r1: 1, _hq_r2: 0 },
    ]);
    expect(rows[0]).toMatchObject({ plan: null, region: '42', score: null, step: 'a', entities: 1 });
    expect(rows[1]).toMatchObject({ entities: 0, conversion_from_previous: 0, dropoff: 1 });
  });
});
