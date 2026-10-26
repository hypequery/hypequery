import { describe, expect, it } from 'vitest';
import { createPostgresQueryBuilder } from '../index.js';

const qb = createPostgresQueryBuilder();

describe('Postgres select compiler', () => {
  it('numbers placeholders in text order across joins, where and in-lists', () => {
    const { sql, parameters } = qb.table('analytics.orders')
      .select(['status'])
      .leftAnyJoin('analytics.customers', 'analytics.orders.customer_id', 'c.customer_id', 'c', { column: 'c.tenant_id', operator: 'eq', value: 't1' })
      .where('status', 'in', ['a', 'b'])
      .where('amount', 'between', [1, 2])
      .toSQLWithParams();
    expect(sql).toBe(
      'SELECT status FROM "analytics"."orders" LEFT JOIN LATERAL (SELECT * FROM analytics.customers AS c '
      + 'WHERE analytics.orders.customer_id = c.customer_id AND c.tenant_id = $1 LIMIT 1) AS c ON TRUE '
      + 'WHERE status IN ($2, $3) AND amount BETWEEN $4 AND $5',
    );
    expect(parameters).toEqual(['t1', 'a', 'b', 1, 2]);
  });

  it('ANDs composite join keys', () => {
    const { sql } = qb.table('o').leftAnyJoin('t', [['o.a', 'x.a'], ['o.b', 'x.b']], 'x').toSQLWithParams();
    expect(sql).toBe('SELECT * FROM "o" LEFT JOIN LATERAL (SELECT * FROM t AS x WHERE o.a = x.a AND o.b = x.b LIMIT 1) AS x ON TRUE');
  });

  it('renders empty in-lists as constant predicates', () => {
    expect(qb.table('t').where('a', 'in', []).where('b', 'notIn', []).toSQLWithParams())
      .toEqual({ sql: 'SELECT * FROM "t" WHERE FALSE AND TRUE', parameters: [] });
  });

  it('groups by the aliased expression, not a same-named source column', () => {
    const { sql } = qb.table('t').select(['upper(region) AS "region"', 'status']).groupBy(['"region"', 'status']).sum('x', '"total"').toSQLWithParams();
    expect(sql).toBe('SELECT upper(region) AS "region", status, SUM(x) AS "total" FROM "t" GROUP BY upper(region), status');
  });

  it('orders NULLs last under DESC like ClickHouse', () => {
    expect(qb.table('t').orderBy('"a"', 'DESC').orderBy('"b"', 'ASC').orderBy('"c"').limit(5).offset(10).toSQLWithParams().sql)
      .toBe('SELECT * FROM "t" ORDER BY "a" DESC NULLS LAST, "b" ASC, "c" LIMIT 5 OFFSET 10');
  });

  it('spells analytical aggregates for Postgres', () => {
    const { sql } = qb.table('t')
      .argMax('r', 'a', '"top"').quantile('a', 0.5, '"p50"').stddev('a', '"sd"').variance('a', '"v"').approxCountDistinct('u', '"n"')
      .toSQLWithParams();
    expect(sql).toBe(
      'SELECT (ARRAY_AGG(r ORDER BY a DESC) FILTER (WHERE a IS NOT NULL))[1] AS "top", '
      + 'percentile_cont(0.5) WITHIN GROUP (ORDER BY a) AS "p50", stddev_samp(a) AS "sd", var_samp(a) AS "v", '
      + 'COUNT(DISTINCT u) AS "n" FROM "t"',
    );
  });

  it('lets the datasets planner spell placeholders', () => {
    const values: unknown[] = [];
    const sql = qb.table('t').where('a', 'eq', 1).where('b', 'eq', 2).toSQLWithPlaceholders(value => {
      values.push(value);
      return `<${values.length}>`;
    });
    expect(sql).toBe('SELECT * FROM "t" WHERE a = <1> AND b = <2>');
    expect(values).toEqual([1, 2]);
  });

  it('wraps converted values, leaving the column bare', () => {
    expect(qb.table('t').whereConverted('"at"', 'between', ['a', 'b'], p => `f(${p})`).toSQLWithParams())
      .toEqual({ sql: 'SELECT * FROM "t" WHERE "at" BETWEEN f($1) AND f($2)', parameters: ['a', 'b'] });
  });

  it('renders null checks without binding', () => {
    expect(qb.table('t').where('"a"', 'isNotNull', undefined).where('"b"', 'isNull', undefined).toSQLWithParams())
      .toEqual({ sql: 'SELECT * FROM "t" WHERE "a" IS NOT NULL AND "b" IS NULL', parameters: [] });
  });

  it('quotes plain table names and keeps subqueries verbatim', () => {
    expect(qb.table('Analytics.Orders').toSQLWithParams().sql).toBe('SELECT * FROM "Analytics"."Orders"');
    expect(qb.table('(SELECT 1) AS s').toSQLWithParams().sql).toBe('SELECT * FROM (SELECT 1) AS s');
  });

  it('is immutable', () => {
    const base = qb.table('t');
    base.where('a', 'eq', 1);
    expect(base.toSQLWithParams().sql).toBe('SELECT * FROM "t"');
  });

  it('rejects unknown operators and execution without a driver', async () => {
    expect(() => qb.table('t').where('a', 'globalIn', [1])).toThrow(/Unsupported filter operator/);
    await expect(async () => qb.table('t').execute()).rejects.toThrow(/no driver/);
  });
});
