import { describe, it, expect } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { createDatasetClient } from './executor.js';
import { validateDatasetQuery } from './dataset-query.js';
import { createInMemoryBackend, type InMemoryTables } from './in-memory-backend.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';
import type { ExecutionContext } from './types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: {
    id: dimension.number(),
    country: dimension.string({ column: 'country_code' }),
    tier: dimension.string(),
  },
});

const Items = dataset('items', {
  source: 'items',
  dimensions: {
    id: dimension.number(),
    orderId: dimension.number({ column: 'order_id' }),
    sku: dimension.string(),
  },
});

const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
    profile: hasOne(() => Customers, { from: 'id', to: 'order_id' }),
    items: hasMany(() => Items, { from: 'id', to: 'order_id' }),
  },
});

const revenueMetric = Orders.metric('revenue', { measure: 'revenue' });

// Dataset with SQL-backed fields, to exercise the "raw SQL under joins" guard.
const SqlOrders = dataset('orders', {
  source: 'orders',
  dimensions: {
    status: dimension.string(),
    lineTotal: dimension.number({ sql: 'price * quantity' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    rawRevenue: measure.sum('amount', { sql: 'sum(amount)' }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
  },
});

// Tenant-scoped datasets for defense-in-depth join tenancy.
const TenantCustomers = dataset('tenant_customers', {
  source: 'tenant_customers',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number(),
    country: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
  },
});

const TenantOrders = dataset('tenant_orders', {
  source: 'tenant_orders',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.number(),
    amount: dimension.number(),
    tenantId: dimension.string({ column: 'tenant_id' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  relationships: {
    customer: belongsTo(() => TenantCustomers, { from: 'customer_id', to: 'id' }),
  },
});

// ---------------------------------------------------------------------------
// Mock builder factory that supports leftJoin and records SQL faithfully.
// ---------------------------------------------------------------------------

function createJoinMockBuilderFactory(): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const state = {
      select: [] as string[],
      joins: [] as string[],
      where: [] as string[],
      groupBy: [] as string[],
      orderBy: [] as string[],
      limit: undefined as number | undefined,
      offset: undefined as number | undefined,
    };

    const agg = (fn: string) => (column: string, alias?: string) => {
      state.select.push(`${fn}(${column}) AS ${alias ?? `${column}_${fn.toLowerCase()}`}`);
      return builder;
    };

    const buildSql = () => {
      let sql = `SELECT ${state.select.length ? state.select.join(', ') : '*'} FROM ${table}`;
      if (state.joins.length) sql += ` ${state.joins.join(' ')}`;
      if (state.where.length) sql += ` WHERE ${state.where.join(' AND ')}`;
      if (state.groupBy.length) sql += ` GROUP BY ${state.groupBy.join(', ')}`;
      if (state.orderBy.length) sql += ` ORDER BY ${state.orderBy.join(', ')}`;
      if (state.limit != null) sql += ` LIMIT ${state.limit}`;
      if (state.offset != null) sql += ` OFFSET ${state.offset}`;
      return sql;
    };

    const builder: QueryBuilderLike = {
      select: (args) => {
        state.select.push(...(Array.isArray(args) ? args : [args]));
        return builder;
      },
      sum: agg('SUM'),
      count: agg('COUNT'),
      countDistinct: (column, alias) => {
        state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
        return builder;
      },
      avg: agg('AVG'),
      min: agg('MIN'),
      max: agg('MAX'),
      where: (column, operator, _value) => {
        const op = operator === 'eq' ? '=' : operator;
        state.where.push(`${column} ${op} ?`);
        return builder;
      },
      leftJoin: (joinTable, leftColumn, rightColumn, alias, on) => {
        const tableClause = alias ? `${joinTable} AS ${alias}` : joinTable;
        const conditions = on ? (Array.isArray(on) ? on : [on]) : [];
        const extra = conditions
          .map(condition => ` AND ${condition.column} ${condition.operator === 'eq' ? '=' : condition.operator} ?`)
          .join('');
        state.joins.push(`LEFT JOIN ${tableClause} ON ${leftColumn} = ${rightColumn}${extra}`);
        return builder;
      },
      groupBy: (args) => {
        state.groupBy.push(...(Array.isArray(args) ? args : [args]));
        return builder;
      },
      orderBy: (column, direction) => {
        state.orderBy.push(`${column} ${direction ?? 'ASC'}`);
        return builder;
      },
      limit: (count) => { state.limit = count; return builder; },
      offset: (count) => { state.offset = count; return builder; },
      toSQLWithParams: () => ({ sql: buildSql(), parameters: [] }),
      execute: async () => [],
    };
    return builder;
  }

  return {
    table: (name: string) => createBuilder(name),
    rawQuery: async () => [],
  };
}

const builderClient = () => createDatasetClient({ queryBuilder: createJoinMockBuilderFactory() });
const backendClient = (tables: InMemoryTables) => createDatasetClient({ backend: createInMemoryBackend(tables) });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('relationship-qualified validation', () => {
  it('accepts a to-one qualified dimension', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts hasOne qualified dimensions', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['profile.country'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects hasMany relationships with a fan-out message', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['items.sku'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hasMany|fan out|not queryable/i);
  });

  it('rejects multi-hop paths', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['customer.region.name'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/one.*hop|single hop/i);
  });

  it('rejects unknown relationships', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['supplier.name'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unknown relationship "supplier"/);
  });

  it('rejects unknown dimensions on the target', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['customer.unknownField'],
      measures: ['revenue'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unknown dimension "unknownField"/);
  });

  it('rejects relationship-qualified measures', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['customer.total'],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Measure "customer.total" is relationship-qualified/);
  });

  it('type-checks qualified filter values', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [{ field: 'customer.tier', operator: 'eq', value: 42 }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/expects a string value/);
  });

  it('accepts a valid qualified filter', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [{ field: 'customer.tier', operator: 'eq', value: 'enterprise' }],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects explicit filters on a joined target tenant column under runtime tenancy', () => {
    const context: ExecutionContext = { runtime: { tenant: { id: 't1' } } };
    const result = validateDatasetQuery(
      TenantOrders,
      {
        dimensions: ['customer.country'],
        measures: ['revenue'],
        filters: [{ field: 'customer.tenantId', operator: 'eq', value: 't1' }],
      },
      context,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/tenant field "customer.tenantId"/);
  });

  it('validates qualified dimensions for metric queries too', () => {
    const client = builderClient();
    const result = client.validate(revenueMetric, { dimensions: ['items.sku'] });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hasMany|not queryable/i);
  });

  it('rejects a hasMany qualified orderBy field with an actionable message', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      orderBy: [{ field: 'items.sku', direction: 'asc' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/hasMany|not queryable/i);
  });

  it('rejects an unknown-relationship qualified orderBy field', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      orderBy: [{ field: 'supplier.name', direction: 'asc' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unknown relationship "supplier"/);
  });

  it('rejects a resolvable qualified orderBy field that is not selected as a dimension', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      orderBy: [{ field: 'customer.country', direction: 'asc' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Unknown orderBy fields: customer\.country/);
  });

  it('accepts a qualified orderBy field when it is also selected as a dimension', () => {
    const result = validateDatasetQuery(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
      orderBy: [{ field: 'customer.country', direction: 'asc' }],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Semantic-backend execution (in-memory hash join)
// ---------------------------------------------------------------------------

describe('relationship joins on the semantic backend', () => {
  const tables: InMemoryTables = {
    orders: [
      { id: 1, status: 'paid', amount: 100, customer_id: 10, created_at: '2024-01-01' },
      { id: 2, status: 'paid', amount: 50, customer_id: 11, created_at: '2024-01-02' },
      { id: 3, status: 'open', amount: 70, customer_id: 99, created_at: '2024-01-03' },
    ],
    customers: [
      { id: 10, country_code: 'US', tier: 'enterprise' },
      { id: 11, country_code: 'DE', tier: 'free' },
    ],
  };

  it('groups a base measure by a joined dimension', async () => {
    const client = backendClient(tables);
    const { data } = await client.execute(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
    });
    expect(data).toContainEqual({ 'customer.country': 'US', revenue: '100' });
    expect(data).toContainEqual({ 'customer.country': 'DE', revenue: '50' });
  });

  it('keeps base rows whose FK has no match (LEFT JOIN semantics)', async () => {
    const client = backendClient(tables);
    const { data } = await client.execute(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
    });
    // Order 3 (customer_id 99) has no matching customer -> country is undefined but the row survives.
    const unmatched = data.find((row) => row['customer.country'] === undefined);
    expect(unmatched).toEqual({ 'customer.country': undefined, revenue: '70' });
    const total = data.reduce((sum, row) => sum + Number(row.revenue), 0);
    expect(total).toBe(220);
  });

  it('filters on a joined dimension', async () => {
    const client = backendClient(tables);
    const { data } = await client.execute(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
      filters: [{ field: 'customer.tier', operator: 'eq', value: 'enterprise' }],
    });
    expect(data).toEqual([{ status: 'paid', revenue: '100' }]);
  });

  it('sorts by a selected joined dimension (orderBy on a joined field works end to end)', async () => {
    const client = backendClient(tables);
    const { data } = await client.execute(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
      orderBy: [{ field: 'customer.country', direction: 'desc' }],
    });
    // Descending by country_code, the matched rows sort US before DE.
    const matched = data.map((row) => row['customer.country']).filter((c) => c !== undefined);
    expect(matched).toEqual(['US', 'DE']);
  });

  it('scopes joined targets by tenant (defense in depth)', async () => {
    const tenantTables: InMemoryTables = {
      tenant_orders: [
        { id: 1, amount: 100, customer_id: 10, tenant_id: 't1' },
        { id: 2, amount: 50, customer_id: 20, tenant_id: 't1' },
      ],
      tenant_customers: [
        { id: 10, country: 'US', tenant_id: 't1' },
        { id: 20, country: 'FR', tenant_id: 't2' },
      ],
    };
    const client = backendClient(tenantTables);
    const context: ExecutionContext = { runtime: { tenant: { id: 't1' } } };
    const { data } = await client.execute(
      TenantOrders,
      { dimensions: ['customer.country'], measures: ['revenue'] },
      context,
    );
    // Order 2's customer (id 20) belongs to tenant t2, so it must not leak across the join.
    expect(data).toContainEqual({ 'customer.country': 'US', revenue: '100' });
    expect(data).toContainEqual({ 'customer.country': undefined, revenue: '50' });
    expect(data.find((row) => row['customer.country'] === 'FR')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Query-builder path SQL
// ---------------------------------------------------------------------------

describe('relationship joins on the query-builder path', () => {
  it('emits a LEFT JOIN and qualified, aliased columns', () => {
    const sql = builderClient().toSQL(Orders, {
      dimensions: ['status', 'customer.country'],
      measures: ['revenue'],
      orderBy: [{ field: 'customer.country', direction: 'asc' }],
    });
    expect(sql).toContain('LEFT JOIN customers AS customer ON orders.customer_id = customer.id');
    expect(sql).toContain('orders.status AS status');
    expect(sql).toContain('customer.country_code AS `customer.country`');
    expect(sql).toContain('SUM(orders.amount) AS revenue');
    expect(sql).toContain('GROUP BY status, `customer.country`');
    expect(sql).toContain('ORDER BY `customer.country` ASC');
  });

  it('deduplicates joins referenced by both a dimension and a filter', () => {
    const sql = builderClient().toSQL(Orders, {
      dimensions: ['customer.country'],
      measures: ['revenue'],
      filters: [{ field: 'customer.tier', operator: 'eq', value: 'enterprise' }],
    });
    const joinCount = (sql.match(/LEFT JOIN customers AS customer/g) ?? []).length;
    expect(joinCount).toBe(1);
    expect(sql).toContain('customer.tier = ?');
  });

  it('injects the joined tenant predicate under runtime tenancy', () => {
    const context: ExecutionContext = { runtime: { tenant: { id: 't1' } } };
    const sql = builderClient().toSQL(
      TenantOrders,
      { dimensions: ['customer.country'], measures: ['revenue'] },
      context,
    );
    expect(sql).toContain(
      'LEFT JOIN tenant_customers AS customer ON tenant_orders.customer_id = customer.id AND customer.tenant_id = ?',
    );
    expect(sql).toContain('tenant_orders.tenant_id = ?');
    expect(sql).not.toContain('WHERE customer.tenant_id = ?');
  });

  it('leaves non-join queries unqualified (no regression)', () => {
    const sql = builderClient().toSQL(Orders, {
      dimensions: ['status'],
      measures: ['revenue'],
    });
    expect(sql).toBe('SELECT status, SUM(amount) AS revenue FROM orders GROUP BY status');
  });

  it('rejects a SQL-backed base dimension combined with a join', () => {
    expect(() => builderClient().toSQL(SqlOrders, {
      dimensions: ['lineTotal', 'customer.country'],
      measures: ['revenue'],
    })).toThrow(/SQL-backed dimension "lineTotal" cannot be combined with relationship joins/);
  });

  it('rejects a SQL-backed measure combined with a join', () => {
    expect(() => builderClient().toSQL(SqlOrders, {
      dimensions: ['customer.country'],
      measures: ['rawRevenue'],
    })).toThrow(/SQL-backed measure "rawRevenue" cannot be combined with relationship joins/);
  });

  it('still allows a SQL-backed base dimension without joins', () => {
    const sql = builderClient().toSQL(SqlOrders, {
      dimensions: ['lineTotal'],
      measures: ['revenue'],
    });
    expect(sql).toContain('price * quantity AS lineTotal');
  });
});
