import type { DatabaseAdapter } from '../adapters/database-adapter.js';
import { ClickHouseDialect } from '../dialects/clickhouse-dialect.js';
import { createQueryBuilder } from '../query-builder.js';
import { substituteParameters } from '../utils.js';
import { rawAs } from '../utils/sql-expressions.js';
import type { TestSchema } from './test-utils.js';

const adapter: DatabaseAdapter = {
  name: 'subquery-tests',
  query: async () => {
    throw new Error('Subquery tests do not execute queries.');
  },
  render: (sql, params = []) => substituteParameters(sql, params),
};

function setupDb() {
  return createQueryBuilder<TestSchema>({
    adapter,
    dialect: new ClickHouseDialect(),
  });
}

describe('QueryBuilder - subquery sources', () => {
  it('builds a nested FROM query from the subquery output columns', () => {
    const db = setupDb();
    const totals = db.table('test_table')
      .where('created_at', 'gte', '2026-06-06')
      .select(['id', 'created_by'])
      .sum('price', 'sum_value')
      .groupBy(['id', 'created_by']);

    const query = db.from(totals)
      .select([
        'id',
        rawAs<string, 'negative_sum_value'>(
          'sumIf(sum_value, sum_value < 0)',
          'negative_sum_value',
        ),
        rawAs<string, 'positive_sum_value'>(
          'sumIf(sum_value, sum_value > 0)',
          'positive_sum_value',
        ),
      ])
      .groupBy('id');

    expect(query.toSQL()).toBe(
      'SELECT id, ' +
      'sumIf(sum_value, sum_value < 0) AS negative_sum_value, ' +
      'sumIf(sum_value, sum_value > 0) AS positive_sum_value ' +
      "FROM (SELECT id, created_by, SUM(price) AS sum_value FROM test_table WHERE created_at >= '2026-06-06' GROUP BY id, created_by) " +
      'GROUP BY id'
    );
  });

  it('preserves nested placeholders before outer-query placeholders', () => {
    const db = setupDb();
    const filtered = db.table('test_table')
      .select(['id', 'category'])
      .where('created_at', 'gte', '2026-06-06')
      .where('active', 'eq', 1);

    const { sql, parameters } = db.from(filtered)
      .select(['id'])
      .where('category', 'eq', 'premium')
      .toSQLWithParams();

    expect(sql).toBe(
      'SELECT id FROM (SELECT id, category FROM test_table WHERE created_at >= ? AND active = ?) WHERE category = ?'
    );
    expect(parameters).toEqual(['2026-06-06', 1, 'premium']);
    expect(db.from(filtered)
      .select(['id'])
      .where('category', 'eq', 'premium')
      .getConfig().parameters
    ).toEqual(['2026-06-06', 1, 'premium']);
  });

  it('recursively compiles multiple subquery levels and their parameters', () => {
    const db = setupDb();
    const activeProducts = db.table('test_table')
      .select(['id', 'category'])
      .where('active', 'eq', 1);
    const premiumProducts = db.from(activeProducts)
      .select(['id', 'category'])
      .where('category', 'eq', 'premium');

    const { sql, parameters } = db.from(premiumProducts)
      .select(['id'])
      .where('id', 'gt', 10)
      .toSQLWithParams();

    expect(sql).toBe(
      'SELECT id FROM ' +
      '(SELECT id, category FROM ' +
      '(SELECT id, category FROM test_table WHERE active = ?) ' +
      'WHERE category = ?) ' +
      'WHERE id > ?'
    );
    expect(parameters).toEqual([1, 'premium', 10]);
  });

  it('snapshots the nested query when creating the outer builder', () => {
    const db = setupDb();
    const inner = db.table('test_table').select(['id']);
    const outer = db.from(inner).select(['id']);
    const node = outer.getQueryNode();

    expect(node.from?.kind).toBe('subquery');
    if (node.from?.kind === 'subquery') {
      node.from.query.select?.push({ kind: 'selection', selection: 'name' });
    }

    expect(outer.toSQL()).toBe('SELECT id FROM (SELECT id FROM test_table)');
  });

  it('requires FINAL to be applied to the inner table query', () => {
    const db = setupDb();
    const inner = db.table('test_table').select(['id']);

    expect(() => db.from(inner).final()).toThrow(
      'Apply final() to the inner query before passing it to db.from().'
    );
    expect(db.from(inner.final()).select(['id']).toSQL()).toBe(
      'SELECT id FROM (SELECT id FROM test_table FINAL)'
    );
  });

  it('rejects PREWHERE clauses on a derived source', () => {
    const db = setupDb();
    const inner = db.table('test_table').select(['id', 'optional_name']);
    const derived = db.from(inner);
    const expectedMessage =
      'PREWHERE can only be applied to a table source. Apply prewhere() to the inner query before passing it to db.from().';

    expect(() => Reflect.apply(derived.prewhere, derived, ['id', 'eq', 1]))
      .toThrow(expectedMessage);
    expect(() => Reflect.apply(derived.orPrewhere, derived, ['id', 'eq', 1]))
      .toThrow(expectedMessage);
    expect(() => Reflect.apply(derived.prewhereNull, derived, ['optional_name']))
      .toThrow(expectedMessage);
    expect(() => Reflect.apply(derived.prewhereNotNull, derived, ['optional_name']))
      .toThrow(expectedMessage);

    expect(db.from(inner.prewhere('id', 'eq', 1)).select(['id']).toSQL()).toBe(
      'SELECT id FROM (SELECT id, optional_name FROM test_table PREWHERE id = 1)'
    );
  });

  it('promotes nested settings for execution and lets outer settings override them', async () => {
    let executedSettings: unknown;
    const settingsAdapter: DatabaseAdapter = {
      ...adapter,
      query: async (_sql, _parameters, options) => {
        executedSettings = options?.clickhouseSettings;
        return [];
      },
    };
    const db = createQueryBuilder<TestSchema>({
      adapter: settingsAdapter,
      dialect: new ClickHouseDialect(),
    });
    const inner = db.table('test_table')
      .settings({ final: 1, max_execution_time: 10 })
      .select(['id']);
    const outer = db.from(inner)
      .settings({ max_execution_time: 20 })
      .select(['id']);

    expect(outer.getQueryNode().settings).toEqual({
      final: 1,
      max_execution_time: 20,
    });
    expect(inner.getQueryNode().settings).toEqual({
      final: 1,
      max_execution_time: 10,
    });

    await outer.execute();

    expect(executedSettings).toEqual({
      final: 1,
      max_execution_time: 20,
    });
  });
});
