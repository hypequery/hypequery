import { rawAs } from '../utils/sql-expressions.js';
import { setupTestBuilder } from './test-utils.js';

describe('QueryBuilder - Composition Semantics', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  it('appends repeated groupBy calls instead of overwriting', () => {
    const sql = builder
      .select(['name', 'category'])
      .groupBy('name')
      .groupBy('category')
      .toSQL();

    expect(sql).toBe('SELECT name, category FROM test_table GROUP BY name, category');
  });

  it('preserves explicit groupBy when aggregations are added later', () => {
    const sql = builder
      .select(['name'])
      .groupBy('name')
      .sum('price')
      .toSQL();

    expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
  });

  it('infers groupBy from aliased expressions when aggregating', () => {
    const sql = builder
      .select([rawAs('toDate(created_at)', 'day')])
      .sum('price')
      .toSQL();

    expect(sql).toBe('SELECT toDate(created_at) AS day, SUM(price) AS price_sum FROM test_table GROUP BY day');
  });

  it('does not duplicate grouping expressions when explicit and inferred grouping overlap', () => {
    const sql = builder
      .select(['name'])
      .sum('price')
      .groupBy('name')
      .toSQL();

    expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
  });

  it('treats empty globalNotIn as a match-all condition', () => {
    const { sql, parameters } = builder
      .where('id', 'globalNotIn', [])
      .toSQLWithParams();

    expect(sql).toBe('SELECT * FROM test_table WHERE 1 = 1');
    expect(parameters).toEqual([]);
  });
});
