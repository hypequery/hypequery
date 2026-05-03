import { setupTestBuilder } from './test-utils.js';

describe('QueryBuilder - Grouping and Ordering', () => {
  let builder: ReturnType<typeof setupTestBuilder>;

  beforeEach(() => {
    builder = setupTestBuilder();
  });

  describe('GROUP BY', () => {
    it('should add GROUP BY for single column', () => {
      const sql = builder
        .select(['name'])
        .sum('price')
        .groupBy('name')
        .toSQL();
      expect(sql).toBe('SELECT name, SUM(price) AS price_sum FROM test_table GROUP BY name');
    });

    it('should add GROUP BY for multiple columns', () => {
      const sql = builder
        .select(['name', 'created_at'])
        .sum('price')
        .groupBy(['name', 'created_at'])
        .toSQL();
      expect(sql).toBe('SELECT name, created_at, SUM(price) AS price_sum FROM test_table GROUP BY name, created_at');
    });

    it('should append when GROUP BY is called multiple times', () => {
      const sql = builder
        .select(['name', 'category'])
        .groupBy('name')
        .groupBy('category')
        .toSQL();
      expect(sql).toBe('SELECT name, category FROM test_table GROUP BY name, category');
    });

    it('should render WITH TOTALS after GROUP BY', () => {
      const sql = builder
        .select(['category'])
        .sum('price')
        .groupBy('category')
        .withTotals()
        .toSQL();
      expect(sql).toBe('SELECT category, SUM(price) AS price_sum FROM test_table GROUP BY category WITH TOTALS');
    });
  });

  describe('ORDER BY', () => {
    it('should add ORDER BY clause', () => {
      const sql = builder
        .select(['name', 'price'])
        .orderBy('price', 'DESC')
        .toSQL();
      expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC');
    });

    it('should combine multiple ORDER BY clauses', () => {
      const sql = builder
        .select(['name', 'price'])
        .orderBy('price', 'DESC')
        .orderBy('name', 'ASC')
        .toSQL();
      expect(sql).toBe('SELECT name, price FROM test_table ORDER BY price DESC, name ASC');
    });

    it('should render LIMIT BY after ORDER BY and before LIMIT', () => {
      const sql = builder
        .select(['name', 'category'])
        .orderBy('price', 'DESC')
        .limitBy(3, ['category'])
        .limit(10)
        .toSQL();
      expect(sql).toBe('SELECT name, category FROM test_table ORDER BY price DESC LIMIT 3 BY category LIMIT 10');
    });
  });

  describe('ARRAY JOIN', () => {
    it('should render ARRAY JOIN after FROM and before WHERE', () => {
      const sql = builder
        .select(['id', 'tags'])
        .arrayJoin('tags')
        .where('id', 'gt', 1)
        .toSQL();
      expect(sql).toBe('SELECT id, tags FROM test_table ARRAY JOIN tags WHERE id > 1');
    });

    it('should render LEFT ARRAY JOIN', () => {
      const sql = builder
        .select(['id', 'categories'])
        .leftArrayJoin('categories')
        .toSQL();
      expect(sql).toBe('SELECT id, categories FROM test_table LEFT ARRAY JOIN categories');
    });
  });
});
