import { CrossFilter, FilterGroup } from '../cross-filter.js';
import { createQueryBuilder } from '../query-builder.js';

// Mock connection to avoid actual DB connection
jest.mock('../connection', () => ({
  ClickHouseConnection: {
    initialize: jest.fn(),
    getClient: jest.fn(() => ({
      query: jest.fn(),
      exec: jest.fn()
    }))
  }
}));

describe('applyCrossFilters Method', () => {
  let db: ReturnType<typeof createQueryBuilder>;

  beforeEach(() => {
    // Initialize query builder with mock connection
    db = createQueryBuilder({
      host: 'http://localhost:8123',
      username: 'default',
      password: 'password',
      database: 'test_db'
    });
  });

  it('should apply simple filters correctly', () => {
    // Create a simple filter
    const filter = new CrossFilter();
    filter.add({
      column: 'status',
      operator: 'eq',
      value: 'active'
    });

    // Apply the filter
    const query = db
      .table('test_table')
      .applyCrossFilters(filter);

    // Verify SQL contains the right WHERE clause
    const sql = query.toSQL();
    expect(sql).toContain('WHERE');
    expect(sql).toContain('status = \'active\'');
  });

  it('should apply multiple AND conditions correctly', () => {
    // Create a filter with multiple AND conditions
    const filter = new CrossFilter();
    filter.add({
      column: 'status',
      operator: 'eq',
      value: 'active'
    });
    filter.add({
      column: 'region',
      operator: 'eq',
      value: 'North'
    });

    // Apply the filter
    const query = db
      .table('test_table')
      .applyCrossFilters(filter);

    // Verify SQL contains the right WHERE clause with AND
    const sql = query.toSQL();
    expect(sql).toContain('WHERE');
    expect(sql).toContain('status = \'active\'');
    expect(sql).toContain('AND');
    expect(sql).toContain('region = \'North\'');
  });

  it('should apply simple OR group correctly', () => {
    // Create a filter with an OR group
    const filter = new CrossFilter();
    filter.addGroup([
      {
        column: 'status',
        operator: 'eq',
        value: 'active'
      },
      {
        column: 'status',
        operator: 'eq',
        value: 'pending'
      }
    ], 'OR');

    // Apply the filter
    const query = db
      .table('test_table')
      .applyCrossFilters(filter);

    // Verify SQL contains the right WHERE clause with parentheses and OR
    const sql = query.toSQL();
    console.log('Generated SQL for OR group:', sql);

    expect(sql).toContain('WHERE');

    // The SQL should have proper grouping with parentheses and OR
    // This might fail with the current implementation
    expect(sql).toMatch(/\(\s*status\s*=\s*'active'\s*OR\s*status\s*=\s*'pending'\s*\)/i);
  });

  it('should apply nested groups correctly', () => {
    // Create a filter with nested groups
    const filter = new CrossFilter();

    // Inner price range group with AND
    const priceGroup: FilterGroup = {
      operator: 'AND',
      conditions: [
        { column: 'price', operator: 'gte', value: 100 },
        { column: 'price', operator: 'lte', value: 200 }
      ]
    };

    // Inner status group with OR
    const statusGroup: FilterGroup = {
      operator: 'OR',
      conditions: [
        { column: 'status', operator: 'eq', value: 'active' },
        { column: 'status', operator: 'eq', value: 'pending' }
      ]
    };

    // Add an outer group with OR logic
    filter.addGroup([
      { column: 'region', operator: 'eq', value: 'North' },
      priceGroup,
      statusGroup
    ], 'OR');

    // Apply the filter
    const query = db
      .table('test_table')
      .applyCrossFilters(filter);

    // Verify exact SQL output
    const sql = query.toSQL();
    console.log('Generated SQL for nested groups:', sql);

    // Expected SQL with proper nesting and operators
    const expectedSQL = "SELECT * FROM test_table WHERE (region = 'North' OR (price >= 100 AND price <= 200) OR (status = 'active' OR status = 'pending'))";

    expect(sql).toBe(expectedSQL);
  });

  it('should combine applyCrossFilters with other query conditions', () => {
    // Create a filter with status conditions
    const filter = new CrossFilter();

    // Add status conditions as an OR group
    filter.addGroup([
      { column: 'status', operator: 'eq', value: 'active' },
      { column: 'status', operator: 'eq', value: 'pending' }
    ], 'OR');

    // Apply the filter and add additional query conditions
    const query = db
      .table('test_table')
      .where('price', 'gt', 50)
      .applyCrossFilters(filter)
      .where('region', 'eq', 'North');

    // Verify exact SQL output
    const sql = query.toSQL();
    console.log('Generated SQL for combined conditions:', sql);

    // Expected SQL with proper nesting and operators
    const expectedSQL = "SELECT * FROM test_table WHERE price > 50 AND (status = 'active' OR status = 'pending') AND region = 'North'";

    expect(sql).toBe(expectedSQL);
  });
}); 