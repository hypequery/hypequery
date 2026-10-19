/**
 * Planner-assembled statements (derived datasets, derived metrics, time
 * measures) take ordering and pagination from the datasets dialect, so an
 * engine can normalize NULL placement and its OFFSET rules.
 */

import { describe, expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { createDatasetClient } from '../executor.js';
import { dimension } from '../field.js';
import { divide, nullIfZero } from '../formulas.js';
import { measure } from '../measure.js';
import { belongsTo } from '../relationships.js';
import type { QueryBuilderFactoryLike } from '../query-builder-protocol.js';
import type { MetricHandle } from '../types.js';
import { clickhouseDatasetSqlDialect } from '../utils/clickhouse-dataset-sql-dialect.js';
import { completeDatasetSqlDialect, defineDatasetSqlDialectRules } from '../utils/dataset-sql-dialect.js';
import { createRenderingBuilderFactory } from './support/sql-equality-harness.js';

/** NULLs last in both directions; OFFSET requires LIMIT (as on BigQuery). */
const strictRules = defineDatasetSqlDialectRules({
  ...clickhouseDatasetSqlDialect,
  name: 'strict-test',
  orderTerm: (expression: string, direction?: 'ASC' | 'DESC') => `${expression} ${direction ?? 'ASC'} NULLS LAST`,
  // Fractional division regardless of operand types (HQ-268 shape).
  formulaBinary: (operator, left, right) => operator === 'divide'
    ? `(CAST(${left} AS DOUBLE) / ${right})`
    : clickhouseDatasetSqlDialect.formulaBinary(operator, left, right),
  paginate: (limit: number | undefined, offset: number | undefined) =>
    offset !== undefined && limit === undefined
      ? ` LIMIT 9223372036854775807 OFFSET ${offset}`
      : clickhouseDatasetSqlDialect.paginate(limit, offset),
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: { createdAt: dimension.timestamp({ column: 'created_at' }), status: dimension.string(), amount: dimension.number() },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('status'),
    aov: measure.derived({ uses: { revenue: 'revenue', orders: 'orders' }, formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)) }),
    rolling: measure.trailing('revenue', { amount: 7, unit: 'day' }),
  },
});
const Aov = (Orders.metric('aovMetric', {
  uses: { revenue: Orders.metric('r', { measure: 'revenue' }), orders: Orders.metric('o', { measure: 'orders' }) },
  formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
}) as unknown as { by(grain: 'day'): MetricHandle }).by('day');

const factory: QueryBuilderFactoryLike = { ...createRenderingBuilderFactory(), datasetSqlDialect: strictRules };
const client = createDatasetClient({ queryBuilder: factory });

describe('dialect ordering and pagination', () => {
  it('uses a registered rule set as-is and still completes partial hooks', () => {
    expect(completeDatasetSqlDialect(strictRules)).toBe(strictRules);
    expect(Object.isFrozen(strictRules)).toBe(true);
    const partial = completeDatasetSqlDialect({ name: 'partial', quoteIdentifier: (id: string) => `"${id}"` });
    expect(partial.orderTerm).toBe(clickhouseDatasetSqlDialect.orderTerm);
  });

  it('quotes relationship sources with a partial hook\'s quoteIdentifier', () => {
    const Customers = dataset('customers', {
      source: 'analytics.customers',
      dimensions: { id: dimension.number({ column: 'customer_id' }), country: dimension.string({ column: 'country_code' }) },
      measures: { customers: measure.countDistinct('id') },
    });
    const Sales = dataset('sales', {
      source: 'analytics.orders',
      dimensions: { status: dimension.string() },
      measures: { revenue: measure.sum('status') },
      relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'customer_id' }) },
    });
    const hook = { name: 'double-quotes', quoteIdentifier: (id: string) => `"${id.replaceAll('"', '""')}"` };
    expect(completeDatasetSqlDialect(hook).quoteQualifiedName('analytics.customers')).toBe('"analytics"."customers"');
    const quoted = createDatasetClient({ queryBuilder: { ...createRenderingBuilderFactory(), datasetSqlDialect: hook } });
    const sql = quoted.toSQL(Sales, { dimensions: ['customer.country'], measures: ['customer.customers'] });
    expect(sql).toContain('FROM "analytics"."customers")');
    expect(sql).not.toContain('`analytics`');
  });

  it('keeps prototype methods of a class-based rule set', () => {
    class ClassRules {
      readonly name = 'class-rules';
      readonly reusesPlaceholders = clickhouseDatasetSqlDialect.reusesPlaceholders;
      readonly embedsPositionalPieces = clickhouseDatasetSqlDialect.embedsPositionalPieces;
      orderTerm(expression: string, direction?: 'ASC' | 'DESC') { return strictRules.orderTerm(expression, direction); }
      paginate(limit: number | undefined, offset: number | undefined) { return strictRules.paginate(limit, offset); }
    }
    Object.setPrototypeOf(ClassRules.prototype, clickhouseDatasetSqlDialect);
    const instance = new ClassRules();
    const registered = defineDatasetSqlDialectRules(instance as unknown as typeof strictRules);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(instance)).toBe(false);
    expect(completeDatasetSqlDialect(registered)).toBe(registered);
    const classClient = createDatasetClient({ queryBuilder: { ...createRenderingBuilderFactory(), datasetSqlDialect: registered } });
    expect(classClient.toSQL(Orders, { dimensions: ['status'], measures: ['aov'], orderBy: [{ field: 'aov', direction: 'desc' }], offset: 20 }))
      .toMatch(/ORDER BY `aov` DESC NULLS LAST LIMIT 9223372036854775807 OFFSET 20$/);
  });

  it('derived dataset statements', () => {
    const sql = client.toSQL(Orders, { dimensions: ['status'], measures: ['aov'], orderBy: [{ field: 'aov', direction: 'desc' }], offset: 20 });
    expect(sql).toMatch(/ORDER BY `aov` DESC NULLS LAST LIMIT 9223372036854775807 OFFSET 20$/);
    expect(client.toSQL(Orders, { by: 'day', measures: ['aov'] })).toMatch(/ORDER BY `period` ASC NULLS LAST$/);
  });

  it('time-measure statements', () => {
    const sql = client.toSQL(Orders, {
      by: 'day', measures: ['rolling'], offset: 3,
      filters: [{ field: 'createdAt', operator: 'between', value: ['2026-01-01', '2026-02-01'] }],
    });
    expect(sql).toMatch(/ORDER BY `period` ASC NULLS LAST LIMIT 9223372036854775807 OFFSET 3$/);
  });

  it('derived metric statements', () => {
    expect(client.toSQL(Aov as never, { limit: 5 } as never)).toMatch(/ORDER BY `period` ASC NULLS LAST LIMIT 5$/);
    expect(client.toSQL(Aov as never, { orderBy: [{ field: 'aovMetric', direction: 'desc' }], offset: 2 } as never))
      .toMatch(/ORDER BY `aovMetric` DESC NULLS LAST LIMIT 9223372036854775807 OFFSET 2$/);
  });

  it('renders derived measure and derived metric formulas through the same dialect rules', () => {
    expect(client.toSQL(Orders, { dimensions: ['status'], measures: ['aov'] }))
      .toContain('(CAST(`revenue` AS DOUBLE) / NULLIF(`orders`, 0)) AS `aov`');
    expect(client.toSQL(Aov as never, {} as never))
      .toContain('(CAST(`revenue` AS DOUBLE) / NULLIF(`orders`, 0)) AS `aovMetric`');
  });

  it('rejects a derived metric formula input that was not declared', () => {
    const Broken = Orders.metric('broken', {
      uses: { revenue: Orders.metric('r2', { measure: 'revenue' }) },
      formula: (() => ({ __type: 'formula_expr', expression: { kind: 'ref', name: 'revenue; DROP TABLE x' }, toSQL: () => '' })) as never,
    }) as MetricHandle;
    expect(() => createDatasetClient({ queryBuilder: createRenderingBuilderFactory() }).toSQL(Broken as never, {} as never))
      .toThrow(/formula references undeclared input "revenue; DROP TABLE x"/);
  });
});
