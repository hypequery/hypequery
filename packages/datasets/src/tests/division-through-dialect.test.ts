/**
 * HQ-268 guard: every division the planner emits goes through the dialect's
 * formulaBinary rule. Postgres truncates `bigint / bigint`, so an engine fixes
 * that in one place; a division that bypassed the rule would silently return
 * integer results on that engine while ClickHouse stayed correct.
 *
 * Author-written raw `sql` expressions are not planner output and are passed
 * through verbatim; lowering them per engine is HQ-277.
 */

import { describe, expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero, round } from '../formulas.js';
import { measure } from '../measure.js';
import type { QueryBuilderFactoryLike } from '../query-builder-protocol.js';
import type { DatasetQuery, MetricHandle, TimeGrain } from '../types.js';
import { clickhouseDatasetSqlDialect } from '../utils/clickhouse-dataset-sql-dialect.js';
import { defineDatasetSqlDialectRules } from '../utils/dataset-sql-dialect.js';
import { createRenderingBuilderFactory } from './support/sql-equality-harness.js';

const markedDivision = defineDatasetSqlDialectRules({
  ...clickhouseDatasetSqlDialect,
  name: 'division-guard',
  formulaBinary: (operator, left, right) => operator === 'divide'
    ? `HQ_DIVIDE(${left}, ${right})`
    : clickhouseDatasetSqlDialect.formulaBinary(operator, left, right),
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }), status: dimension.string(), amount: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    completed: measure.count('status', { filters: [{ field: 'status', operator: 'eq', value: 'completed' }] }),
    completionRate: measure.derived({ uses: { completed: 'completed', orders: 'orders' }, formula: ({ completed, orders }) => divide(completed, nullIfZero(orders)) }),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => round(divide(revenue, nullIfZero(orders)), 2) }),
    aovShare: measure.derived({ uses: { aov: 'aov', revenue: 'revenue' }, formula: ({ aov, revenue }) => divide(aov, nullIfZero(revenue)) }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
    rollingRatio: measure.derived({ uses: { rolling: 'rolling', revenue: 'revenue' }, formula: ({ rolling, revenue }) => divide(revenue, nullIfZero(rolling)) }),
    prior: measure.shift('revenue', { amount: 1, unit: 'month' }),
    growth: measure.derived({ uses: { revenue: 'revenue', prior: 'prior' }, formula: ({ revenue, prior }) => divide(revenue, nullIfZero(prior)) }),
    priorAov: measure.shift('aov', { amount: 1, unit: 'month' }),
  },
});
const ratioInputs = { completed: Orders.metric('c', { measure: 'completed' }), orders: Orders.metric('o', { measure: 'orders' }) };
const Rate = Orders.metric('rate', { uses: ratioInputs, formula: ({ completed, orders }) => divide(completed, nullIfZero(orders)) }) as MetricHandle;
const MonthlyRate = (Orders.metric('monthlyRate', { uses: ratioInputs, formula: ({ completed, orders }) => divide(completed, nullIfZero(orders)) }) as unknown as { by(grain: TimeGrain): MetricHandle }).by('month');

const factory: QueryBuilderFactoryLike = { ...createRenderingBuilderFactory(), datasetSqlDialect: markedDivision };
const client = createDatasetClient({ queryBuilder: factory });
const RANGE = [{ field: 'createdAt', operator: 'between' as const, value: ['2026-01-01', '2026-03-01'] }];

const datasetPaths: Record<string, DatasetQuery> = {
  'count / count': { dimensions: ['status'], measures: ['completionRate'] },
  'sum / count, rounded': { measures: ['aov'] },
  'nested derived': { measures: ['aovShare'] },
  'grouped ratio at a time grain': { by: 'month', dimensions: ['status'], measures: ['completionRate'] },
  'having on a ratio': { dimensions: ['status'], measures: ['revenue', 'completionRate'], having: [{ measure: 'completionRate', operator: 'gt', value: 0.5 }] },
  'ratio over a window': { by: 'day', measures: ['rollingRatio'], filters: RANGE },
  'ratio over a shift': { by: 'day', measures: ['growth'], filters: RANGE },
  'composite shifted ratio': { by: 'month', measures: ['priorAov'], filters: RANGE },
};

function expectNoBareDivision(sql: string) {
  expect(sql).toContain('HQ_DIVIDE(');
  expect(sql).not.toMatch(/\s\/\s/);
}

describe('every planner division goes through the dialect', () => {
  it.each(Object.entries(datasetPaths))('dataset: %s', (_name, query) => {
    const compilation = client.compileDataset(Orders, query as never);
    expectNoBareDivision(compilation.sql);
  });

  it.each([['derived metric', Rate], ['grained derived metric', MonthlyRate]] as const)('%s', (_name, metric) => {
    expectNoBareDivision(client.toSQL(metric as never, {} as never));
  });
});
