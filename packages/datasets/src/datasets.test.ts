import { describe, it, expect, vi } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { sum, count, countDistinct, avg, min, max } from './aggregations.js';
import { divide, multiply, subtract, add, nullIfZero, coalesce, round, floor, ceil } from './formulas.js';
import { eq, neq, gt, gte, lt, lte, inList, notInList, between, like, desc } from './query-helpers.js';
import { measure } from './measure.js';
import { createDatasetRegistry } from './registry.js';
import { buildDatasetQueryBuilder, runDatasetQuery, validateDatasetQuery } from './dataset-query.js';
import { createDatasetClient, MetricQueryEngine } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: "tenant_id" }),
    name: dimension.string({ label: "Customer Name" }),
    country: dimension.string({ label: "Country" }),
    createdAt: dimension.timestamp(),
  },
  measures: {
    customerCount: measure.count('id'),
  },
});

const Orders = dataset("orders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: "tenant_id" }),
    customerId: dimension.string({ column: "customer_id" }),
    country: dimension.string({ label: "Country" }),
    status: dimension.string({ label: "Order Status" }),
    amount: dimension.number({ label: "Amount" }),
    createdAt: dimension.timestamp({ label: "Created At" }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    uniqueCustomers: measure.countDistinct('customerId'),
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
  relationships: {
    customer: belongsTo(() => Customers, { from: "customerId", to: "id" }),
  },
  limits: {
    maxDimensions: 5,
    maxFilters: 10,
  },
});

const TENANT_CONTEXT = {
  runtime: {
    tenant: { id: "tenant-1" },
  },
} as const;

// =============================================================================
// DATASET + FIELD TESTS
// =============================================================================

describe("dataset()", () => {
  it("creates a dataset with correct properties", () => {
    expect(Orders.__type).toBe("dataset");
    expect(Orders.name).toBe("orders");
    expect(Orders.source).toBe("orders");
    expect(Orders.tenantKey).toBe("tenant_id");
    expect(Orders.timeKey).toBe("created_at");
  });

  it("stores dimension definitions", () => {
    expect(Orders.dimensions.amount.__type).toBe("field_definition");
    expect(Orders.dimensions.amount.fieldType).toBe("number");
    expect(Orders.dimensions.amount.label).toBe("Amount");
  });

  it("stores relationships", () => {
    const rel = Orders.relationships.customer;
    expect(rel.__type).toBe("relationship");
    expect(rel.kind).toBe("belongsTo");
    expect(rel.from).toBe("customerId");
    expect(rel.to).toBe("id");
    expect(rel.target()).toBe(Customers);
  });

  it("stores limits", () => {
    expect(Orders.limits?.maxDimensions).toBe(5);
    expect(Orders.limits?.maxFilters).toBe(10);
  });
});

describe("field helpers", () => {
  it("creates string field", () => {
    const f = dimension.string({ label: "Name" });
    expect(f.fieldType).toBe("string");
    expect(f.label).toBe("Name");
  });

  it("creates number field", () => {
    const f = dimension.number();
    expect(f.fieldType).toBe("number");
    expect(f.label).toBeUndefined();
  });

  it("creates boolean field", () => {
    expect(dimension.boolean().fieldType).toBe("boolean");
  });

  it("creates timestamp field", () => {
    expect(dimension.timestamp().fieldType).toBe("timestamp");
  });
});

// =============================================================================
// RELATIONSHIP TESTS
// =============================================================================

describe("relationship helpers", () => {
  it("belongsTo", () => {
    const rel = belongsTo(() => Customers, { from: "customerId", to: "id" });
    expect(rel.kind).toBe("belongsTo");
  });

  it("hasMany", () => {
    const rel = hasMany(() => Orders, { from: "id", to: "customerId" });
    expect(rel.kind).toBe("hasMany");
  });

  it("hasOne", () => {
    const rel = hasOne(() => Orders, { from: "id", to: "customerId" });
    expect(rel.kind).toBe("hasOne");
  });
});

// =============================================================================
// AGGREGATION TESTS
// =============================================================================

describe("aggregation helpers", () => {
  it("sum", () => {
    const s = sum("amount");
    expect(s.__type).toBe("aggregation_spec");
    expect(s.aggregation).toBe("sum");
    expect(s.field).toBe("amount");
  });

  it("count", () => {
    expect(count("id").aggregation).toBe("count");
  });

  it("countDistinct", () => {
    expect(countDistinct("customerId").aggregation).toBe("countDistinct");
  });

  it("avg", () => {
    expect(avg("amount").aggregation).toBe("avg");
  });

  it("min", () => {
    expect(min("amount").aggregation).toBe("min");
  });

  it("max", () => {
    expect(max("amount").aggregation).toBe("max");
  });
});

// =============================================================================
// METRIC DEFINITION TESTS
// =============================================================================

describe("Dataset.metric()", () => {
  it("creates a base metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", {
      measure: "revenue",
      label: "Total Revenue",
      description: "Sum of all order amounts",
    });

    expect(totalRevenue.__type).toBe("metric_ref");
    expect(totalRevenue.name).toBe("totalRevenue");
    expect(totalRevenue.datasetName).toBe("orders");
    expect(totalRevenue.label).toBe("Total Revenue");
    expect(totalRevenue.spec.__type).toBe("aggregation_spec");
  });

  it("creates a derived metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { measure: "revenue" });
    const orderCount = Orders.metric("orderCount", { measure: "orderCount" });

    const avgOrderValue = Orders.metric("avgOrderValue", {
      uses: { revenue: totalRevenue, orders: orderCount },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
      label: "Average Order Value",
    });

    expect(avgOrderValue.__type).toBe("metric_ref");
    expect(avgOrderValue.spec.__type).toBe("derived_metric_spec");
  });

  it("rejects base metrics that reference unknown measures", () => {
    expect(() =>
      Orders.metric("badRevenue", { measure: "nonexistentMeasure" })
    ).toThrow('measure "nonexistentMeasure" does not exist on dataset "orders"');
  });

  it("measure validation happens at dataset definition time", () => {
    // This test verifies that measure validation (like numeric checks)
    // happens when the measure is defined, not when the metric is created
    // Since Orders.measures.revenue is already validated, creating a metric from it is safe
    expect(() => Orders.metric("validRevenue", { measure: "revenue" })).not.toThrow();
  });

  it("rejects derived metrics that reference another dataset", () => {
    const totalRevenue = Orders.metric("totalRevenue", { measure: "revenue" });
    const customerCount = Customers.metric("customerCount", { measure: "customerCount" });

    expect(() =>
      Orders.metric("invalidCrossDataset", {
        uses: { totalRevenue, customerCount },
        formula: ({ totalRevenue: revenue, customerCount: customers }) =>
          divide(revenue, nullIfZero(customers)),
      })
    ).toThrow('belongs to dataset "customers"');
  });

  it(".by() creates a grained metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { measure: "revenue" });
    const monthly = totalRevenue.by("month");

    expect(monthly.__type).toBe("grained_metric_ref");
    expect(monthly.grain).toBe("month");
    expect(monthly.metric).toBe(totalRevenue);
  });

  it(".by() throws if dataset has no timeKey", () => {
    const m = Customers.metric("count", { measure: "customerCount" });
    expect(() => m.by("month")).toThrow("no timeKey");
  });
});

describe("Dataset public surface", () => {
  it("does not expose dataset.query()", () => {
    expect('query' in (Orders as unknown as Record<string, unknown>)).toBe(false);
    expect(Orders.relationships.customer.target()).toBe(Customers);
  });
});

describe("dataset query helpers", () => {
  function createDatasetQueryBuilderFactory(mockData: Record<string, unknown>[] = []): QueryBuilderFactoryLike {
    function createBuilder(): QueryBuilderLike {
      const state = {
        select: [] as string[],
        where: [] as string[],
        groupBy: [] as string[],
        orderBy: [] as string[],
        limit: undefined as number | undefined,
        offset: undefined as number | undefined,
      };

      const buildSql = () => [
        `SELECT ${state.select.join(', ')} FROM orders`,
        state.where.length > 0 ? `WHERE ${state.where.join(' AND ')}` : '',
        state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.join(', ')}` : '',
        state.orderBy.length > 0 ? `ORDER BY ${state.orderBy.join(', ')}` : '',
        state.limit != null ? `LIMIT ${state.limit}` : '',
        state.offset != null ? `OFFSET ${state.offset}` : '',
      ].filter(Boolean).join(' ');

      const builder: QueryBuilderLike = {
        select: (args: string | string[]) => {
          state.select.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        sum: (column: string, alias?: string) => {
          state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
          return builder;
        },
        count: (column: string, alias?: string) => {
          state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
          return builder;
        },
        countDistinct: (column: string, alias?: string) => {
          state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
          return builder;
        },
        avg: (column: string, alias?: string) => {
          state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
          return builder;
        },
        min: (column: string, alias?: string) => {
          state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
          return builder;
        },
        max: (column: string, alias?: string) => {
          state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
          return builder;
        },
        where: (column: string, operator: string, _value: unknown) => {
          const op = operator === 'eq' ? '=' : operator;
          state.where.push(`${column} ${op} ?`);
          return builder;
        },
        groupBy: (args: string | string[]) => {
          state.groupBy.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        orderBy: (column: string, direction?: string) => {
          state.orderBy.push(`${column} ${direction ?? 'ASC'}`);
          return builder;
        },
        limit: (count: number) => {
          state.limit = count;
          return builder;
        },
        offset: (count: number) => {
          state.offset = count;
          return builder;
        },
        toSQLWithParams: () => ({
          sql: buildSql(),
          parameters: [],
        }),
        execute: vi.fn().mockResolvedValue(mockData),
      };

      return builder;
    }

    return {
      table: () => createBuilder(),
      rawQuery: vi.fn().mockResolvedValue(mockData),
    };
  }

  it("validates dataset queries and rejects explicit tenant filters under runtime tenancy", () => {
    const validation = validateDatasetQuery(Orders, {
      measures: ['revenue'],
      filters: [eq('tenantId', 'tenant-123')],
    }, {
      runtime: {
        tenant: {
          id: 'tenant-123',
        },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([
      'Cannot filter on tenant field "tenantId" when runtime tenancy enforcement is active.',
    ]);
  });

  it("rejects tenant-keyed dataset queries without runtime tenant scoping", () => {
    const validation = validateDatasetQuery(Orders, {
      measures: ['revenue'],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors[0]).toContain('Dataset "orders" requires runtime tenant scoping.');
  });

  it("builds dataset query SQL through the shared datasets planner", () => {
    const builder = buildDatasetQueryBuilder(Orders, {
      dimensions: ['status'],
      measures: ['completedRevenue'],
      filters: [eq('country', 'ES')],
      orderBy: [desc('completedRevenue')],
      limit: 5,
    }, {
      builderFactory: createDatasetQueryBuilderFactory(),
      context: {
        runtime: {
          tenant: {
            id: 'tenant-123',
          },
        },
      },
    });

    expect(builder.toSQLWithParams().sql).toContain('SELECT status, SUM(if((status = \'completed\'), amount, 0)) AS completedRevenue FROM orders');
    expect(builder.toSQLWithParams().sql).toContain('WHERE tenant_id = ? AND country = ?');
    expect(builder.toSQLWithParams().sql).toContain('GROUP BY status');
    expect(builder.toSQLWithParams().sql).toContain('ORDER BY completedRevenue DESC');
    expect(builder.toSQLWithParams().sql).toContain('LIMIT 5');
  });

  it("executes dataset queries and returns meta", async () => {
    const result = await runDatasetQuery(Orders, {
      measures: ['revenue'],
    }, {
      builderFactory: createDatasetQueryBuilderFactory([{ revenue: 42 }]),
      context: TENANT_CONTEXT,
    });

    expect(result.data).toEqual([{ revenue: 42 }]);
    expect(result.meta?.sql).toContain('SUM(amount) AS revenue');
  });
});

// =============================================================================
// CONTRACT TESTS
// =============================================================================

describe("metric.contract()", () => {
  it("returns contract for a base metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", {
      measure: "revenue",
      label: "Total Revenue",
    });

    const contract = totalRevenue.contract();
    expect(contract.kind).toBe("metric");
    expect(contract.name).toBe("totalRevenue");
    expect(contract.dataset).toBe("orders");
    expect(contract.valueType).toBe("number");
    expect(contract.tenantScoped).toBe(true);
    expect(contract.dimensions).toContain("country");
    expect(contract.grains).toEqual(["day", "week", "month", "quarter", "year"]);
  });

  it("returns contract for a derived metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { measure: "revenue" });
    const orderCount = Orders.metric("orderCount", { measure: "orderCount" });
    const avgOV = Orders.metric("avgOrderValue", {
      uses: { revenue: totalRevenue, orders: orderCount },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    });

    const contract = avgOV.contract();
    expect(contract.kind).toBe("derived_metric");
    expect(contract.requires).toEqual(["revenue", "orders"]);
  });

  it("returns contract for a grained metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { measure: "revenue" });
    const monthly = totalRevenue.by("month");

    const contract = monthly.contract();
    expect(contract.kind).toBe("grained_metric");
    expect(contract.grain).toBe("month");
  });
});

// =============================================================================
// FORMULA TESTS
// =============================================================================

describe("formula helpers", () => {
  it("divide", () => {
    expect(divide("a", "b").toSQL()).toBe("(a) / (b)");
  });

  it("multiply", () => {
    expect(multiply("a", "b").toSQL()).toBe("(a) * (b)");
  });

  it("subtract", () => {
    expect(subtract("a", "b").toSQL()).toBe("(a) - (b)");
  });

  it("add", () => {
    expect(add("a", "b").toSQL()).toBe("(a) + (b)");
  });

  it("nullIfZero", () => {
    expect(nullIfZero("x").toSQL()).toBe("NULLIF(x, 0)");
  });

  it("coalesce", () => {
    expect(coalesce("x", 0).toSQL()).toBe("COALESCE(x, 0)");
  });

  it("round", () => {
    expect(round("x", 2).toSQL()).toBe("ROUND(x, 2)");
  });

  it("floor", () => {
    expect(floor("x").toSQL()).toBe("FLOOR(x)");
  });

  it("ceil", () => {
    expect(ceil("x").toSQL()).toBe("CEIL(x)");
  });

  it("composition: divide(a, nullIfZero(b))", () => {
    expect(divide("revenue", nullIfZero("orders")).toSQL()).toBe(
      "(revenue) / (NULLIF(orders, 0))"
    );
  });
});

// =============================================================================
// REGISTRY TESTS
// =============================================================================

describe("DatasetRegistry", () => {
  it("registers and retrieves datasets", () => {
    const registry = createDatasetRegistry();
    registry.register(Orders);
    registry.register(Customers);

    expect(registry.has("orders")).toBe(true);
    expect(registry.get("orders")).toBe(Orders);
    expect(registry.getAll().length).toBe(2);
  });

  it("throws on duplicate registration", () => {
    const registry = createDatasetRegistry();
    registry.register(Orders);
    expect(() => registry.register(Orders)).toThrow("already registered");
  });
});

// =============================================================================
// METRIC QUERY ENGINE TESTS
// =============================================================================

describe("MetricQueryEngine", () => {
  type BuilderColumnsInput = string[] | string;

  function createMockBuilderFactory(): QueryBuilderFactoryLike {
    const mockData = [
      { country: "US", totalRevenue: 5000 },
      { country: "DE", totalRevenue: 3000 },
    ];

    function createMockBuilder(): QueryBuilderLike {
      const state = {
        select: [] as string[],
        where: [] as string[],
        groupBy: [] as string[],
        orderBy: [] as string[],
        limit: undefined as number | undefined,
        offset: undefined as number | undefined,
      };

      const buildSql = () => {
        const select = state.select.length > 0
          ? state.select.join(", ")
          : "*";
        let sql = `SELECT ${select} FROM orders`;
        if (state.where.length > 0) {
          sql += ` WHERE ${state.where.join(" AND ")}`;
        }
        if (state.groupBy.length > 0) {
          sql += ` GROUP BY ${state.groupBy.join(", ")}`;
        }
        if (state.orderBy.length > 0) {
          sql += ` ORDER BY ${state.orderBy.join(", ")}`;
        }
        if (state.limit != null) {
          sql += ` LIMIT ${state.limit}`;
        }
        if (state.offset != null) {
          sql += ` OFFSET ${state.offset}`;
        }
        return sql;
      };

      const builder: QueryBuilderLike = {
        select: (args: BuilderColumnsInput) => {
          state.select.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        sum: (column: string, alias?: string) => {
          state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
          return builder;
        },
        count: (column: string, alias?: string) => {
          state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
          return builder;
        },
        countDistinct: (column: string, alias?: string) => {
          state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
          return builder;
        },
        avg: (column: string, alias?: string) => {
          state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
          return builder;
        },
        min: (column: string, alias?: string) => {
          state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
          return builder;
        },
        max: (column: string, alias?: string) => {
          state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
          return builder;
        },
        where: (column: string, operator: string, _value: unknown) => {
          const op = operator === 'eq' ? '=' : operator;
          state.where.push(`${column} ${op} ?`);
          return builder;
        },
        groupBy: (args: BuilderColumnsInput) => {
          state.groupBy.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        orderBy: (column: string, direction?: string) => {
          state.orderBy.push(`${column} ${direction ?? 'ASC'}`);
          return builder;
        },
        limit: (count: number) => {
          state.limit = count;
          return builder;
        },
        offset: (count: number) => {
          state.offset = count;
          return builder;
        },
        toSQLWithParams: () => ({
          sql: buildSql(),
          parameters: [],
        }),
        execute: vi.fn().mockResolvedValue(mockData),
      };
      return builder;
    }

    return {
      table: (name: string) => createMockBuilder(),
      rawQuery: vi.fn().mockResolvedValue(mockData),
    };
  }

  function createBrokenDerivedGroupingBuilderFactory(): QueryBuilderFactoryLike {
    function createBrokenBuilder(): QueryBuilderLike {
      const state = {
        select: [] as string[],
        where: [] as string[],
        groupBy: [] as string[],
      };

      const maybeInferBrokenGroupBy = () => {
        if (state.select.length > 0 && state.groupBy.length === 0) {
          const aliasMatch = state.select[0].match(/\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)$/i);
          if (aliasMatch) {
            state.groupBy.push(aliasMatch[1]);
          }
        }
      };

      const builder: QueryBuilderLike = {
        select: (args: BuilderColumnsInput) => {
          state.select.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        sum: (column: string, alias?: string) => {
          state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
          return builder;
        },
        count: (column: string, alias?: string) => {
          maybeInferBrokenGroupBy();
          state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
          return builder;
        },
        countDistinct: (column: string, alias?: string) => {
          maybeInferBrokenGroupBy();
          state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
          return builder;
        },
        avg: (column: string, alias?: string) => {
          maybeInferBrokenGroupBy();
          state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
          return builder;
        },
        min: (column: string, alias?: string) => {
          maybeInferBrokenGroupBy();
          state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
          return builder;
        },
        max: (column: string, alias?: string) => {
          maybeInferBrokenGroupBy();
          state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
          return builder;
        },
        where: (column: string, operator: string, _value: unknown) => {
          const op = operator === 'eq' ? '=' : operator;
          state.where.push(`${column} ${op} ?`);
          return builder;
        },
        groupBy: (args: BuilderColumnsInput) => {
          state.groupBy.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        orderBy: () => builder,
        limit: () => builder,
        offset: () => builder,
        toSQLWithParams: () => ({
          sql: [
            `SELECT ${state.select.join(', ')} FROM orders`,
            state.where.length > 0 ? `WHERE ${state.where.join(' AND ')}` : '',
            state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.join(', ')}` : '',
          ].filter(Boolean).join(' '),
          parameters: [],
        }),
        execute: vi.fn().mockResolvedValue([]),
      };

      return builder;
    }

    return {
      table: () => createBrokenBuilder(),
      rawQuery: vi.fn().mockResolvedValue([]),
    };
  }

  const totalRevenue = Orders.metric("totalRevenue", {
    measure: "revenue",
    label: "Total Revenue",
  });
  const orderCount = Orders.metric("orderCount", { measure: "orderCount" });
  const uniqueCustomers = Orders.metric("uniqueCustomers", {
    measure: "uniqueCustomers",
  });
  const completedRevenue = Orders.metric("completedRevenue", {
    measure: "completedRevenue",
  });
  const avgOrderValue = Orders.metric("avgOrderValue", {
    uses: { totalRevenue, orderCount },
    formula: ({ totalRevenue, orderCount }) =>
      divide(totalRevenue, nullIfZero(orderCount)),
  });

  describe("toSQL() — base metrics", () => {
    it("generates simple aggregate SQL", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(totalRevenue, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(sql).toContain("SELECT country, SUM(amount) AS totalRevenue FROM orders");
      expect(sql).toContain("GROUP BY country");
    });

    it("injects tenant WHERE clause", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(totalRevenue, {
        dimensions: ["country"],
      }, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      expect(sql).toContain("WHERE tenant_id = ?");
    });

    it("applies user filters", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(totalRevenue, {
        dimensions: ["country"],
        filters: [{ field: "status", operator: "eq", value: "completed" }],
      }, TENANT_CONTEXT);

      expect(sql).toContain("status = ?");
    });

    it("applies ORDER BY and LIMIT", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "totalRevenue", direction: "desc" }],
        limit: 100,
      }, TENANT_CONTEXT);

      expect(sql).toContain("ORDER BY totalRevenue DESC");
      expect(sql).toContain("LIMIT 100");
    });

    it("compiles filtered measures into aggregation expressions", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(completedRevenue, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(sql).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
      expect(sql).toContain("GROUP BY country");
    });

    it("resolves column aliases for countDistinct metrics", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(uniqueCustomers, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(sql).toContain("COUNT(DISTINCT customer_id) AS uniqueCustomers");
      expect(sql).not.toContain("COUNT(DISTINCT customerId)");
    });
  });

  describe("toSQL() — grained metrics", () => {
    it("generates time-grained SQL with .by()", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const monthly = totalRevenue.by("month");
      const sql = analytics.toSQL(monthly, {}, TENANT_CONTEXT);

      expect(sql).toContain("toStartOfMonth(created_at) AS period");
      expect(sql).toContain("GROUP BY period");
      expect(sql).toContain("ORDER BY period");
    });

    it("supports grain via query.by", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(totalRevenue, { by: "week" }, TENANT_CONTEXT);

      expect(sql).toContain("toStartOfWeek(created_at) AS period");
    });

    it("rejects conflicting query.by on grained metrics", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const monthly = totalRevenue.by("month");
      const result = analytics.validate(monthly, { by: "week" }, TENANT_CONTEXT);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('already grained by "month"');
    });
  });

  describe("toSQL() — derived metrics", () => {
    it("generates CTE-based SQL", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(avgOrderValue, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("SUM(amount) AS totalRevenue");
      expect(sql).toContain("COUNT(id) AS orderCount");
      expect(sql).toContain("FROM base");
      expect(sql).toContain("(totalRevenue) / (NULLIF(orderCount, 0)) AS avgOrderValue");
      expect(sql).not.toContain("SELECT country, (totalRevenue) / (NULLIF(orderCount, 0)) AS avgOrderValue, totalRevenue, orderCount FROM base");
    });

    it("does not emit GROUP BY for ungrouped derived metrics", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const sql = analytics.toSQL(avgOrderValue, {}, TENANT_CONTEXT);

      expect(sql).toContain("WITH base AS");
      expect(sql).not.toContain("GROUP BY totalRevenue");
      expect(sql).not.toContain("GROUP BY orderCount");
    });

    it("rejects derived plans that introduce aggregate aliases into GROUP BY", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createBrokenDerivedGroupingBuilderFactory() });
      const result = analytics.validate(avgOrderValue, {}, TENANT_CONTEXT);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("GROUP BY");
    });
  });

  describe("run()", () => {
    it("executes SQL and returns MetricResult", async () => {
      const builderFactory = createMockBuilderFactory();
      const analytics = new MetricQueryEngine({ builderFactory });
      const result = await analytics.run(totalRevenue, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(result.data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
      expect(result.meta.sql).toBeDefined();
      expect(result.meta.timingMs).toBeGreaterThanOrEqual(0);
    });

    it("passes tenant context to SQL", async () => {
      const builderFactory = createMockBuilderFactory();
      const analytics = new MetricQueryEngine({ builderFactory });

      await analytics.run(totalRevenue, {}, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      // Verify the SQL was generated (toSQL includes tenant filter)
      const sql = analytics.toSQL(totalRevenue, {}, {
        runtime: {
          tenant: { id: "t1" },
        },
      });
      expect(sql).toContain("tenant_id");
    });
  });

  describe("createDatasetClient()", () => {
    it("can execute semantic plans against an in-memory backend without a query builder", async () => {
      const analytics = createDatasetClient({
        backend: createInMemoryBackend({
          orders: [
            { id: "1", tenant_id: "t1", country: "US", status: "completed", amount: 100, created_at: "2026-01-02" },
            { id: "2", tenant_id: "t1", country: "US", status: "pending", amount: 50, created_at: "2026-01-03" },
            { id: "3", tenant_id: "t1", country: "DE", status: "completed", amount: 75, created_at: "2026-01-04" },
            { id: "4", tenant_id: "t2", country: "US", status: "completed", amount: 999, created_at: "2026-01-05" },
          ],
        }),
      });

      const result = await analytics.execute(avgOrderValue, {
        dimensions: ["country"],
        filters: [{ field: "status", operator: "eq", value: "completed" }],
        orderBy: [{ field: "country", direction: "asc" }],
      }, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      expect(result.data).toEqual([
        { country: "DE", avgOrderValue: 75 },
        { country: "US", avgOrderValue: 100 },
      ]);

      const datasetResult = await analytics.execute(Orders, {
        dimensions: ["country"],
        measures: ["revenue", "orderCount"],
        filters: [{ field: "status", operator: "eq", value: "completed" }],
        orderBy: [{ field: "revenue", direction: "desc" }],
      }, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      expect(datasetResult.data).toEqual([
        { country: "US", revenue: 100, orderCount: 1 },
        { country: "DE", revenue: 75, orderCount: 1 },
      ]);
    });

    it("executes metric queries through the semantic analytics", async () => {
      const builderFactory = createMockBuilderFactory();
      const analytics = createDatasetClient({ queryBuilder: builderFactory });

      const result = await analytics.execute(totalRevenue, {
        dimensions: ["country"],
      }, TENANT_CONTEXT);

      expect(result.data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
      expect(result.meta.sql).toContain("SUM(amount) AS totalRevenue");
    });

    it("executes dataset queries through the semantic analytics", async () => {
      const builderFactory = createMockBuilderFactory();
      const analytics = createDatasetClient({ queryBuilder: builderFactory });

      const result = await analytics.execute(Orders, {
        dimensions: ["country"],
        measures: ["revenue"],
      }, TENANT_CONTEXT);

      expect(result.data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
      expect(result.meta.sql).toContain("SELECT country, SUM(amount) AS revenue FROM orders");
    });

    it("generates and validates dataset queries", () => {
      const builderFactory = createMockBuilderFactory();
      const analytics = createDatasetClient({ queryBuilder: builderFactory });

      const validation = analytics.validate(Orders, {
        dimensions: ["country"],
        measures: ["revenue"],
      }, TENANT_CONTEXT);
      const sql = analytics.toSQL(Orders, {
        dimensions: ["country"],
        measures: ["revenue"],
      }, TENANT_CONTEXT);

      expect(validation.valid).toBe(true);
      expect(sql).toContain("GROUP BY country");
    });
  });

  describe("validate()", () => {
    it("rejects tenant-keyed metric queries without runtime tenant scoping", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        dimensions: ["country"],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Dataset "orders" requires runtime tenant scoping.');
    });

    it("accepts valid queries", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        dimensions: ["country", "status"],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(true);
    });

    it("rejects unknown dimensions", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        dimensions: ["nonexistent"],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown dimension");
    });

    it("rejects unknown filter fields", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "nonexistent", operator: "eq", value: "x" }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
    });

    it("rejects incompatible filter values", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "eq", value: "not-a-number" }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a number value');
    });

    it("rejects empty arrays for in/notIn filters", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "status", operator: "in", value: [] }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a non-empty array');
    });

    it("rejects malformed between filters", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "between", value: [1] }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"between" expects a two-item array');
    });

    it("rejects like on numeric fields", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "like", value: "%100%" }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"like" is only supported');
    });

    it("rejects unknown orderBy fields", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "amount", direction: "desc" }],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown orderBy field");
    });

    it("rejects exceeding dimension limits", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        dimensions: ["id", "customerId", "country", "status", "amount", "createdAt"],
      }, TENANT_CONTEXT);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Too many dimensions");
    });

    it("rejects explicit tenant filters when runtime tenancy is active", () => {
      const analytics = new MetricQueryEngine({ builderFactory: createMockBuilderFactory() });
      const result = analytics.validate(totalRevenue, {
        filters: [{ field: "tenantId", operator: "eq", value: "t1" }],
      }, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Cannot filter on tenant field "tenantId"');
    });
  });
});

describe("dataset SQL generation matrix", () => {
  type BuilderColumnsInput = string[] | string;

  const MatrixOrders = dataset("matrixOrders", {
    source: "orders",
    tenantKey: "tenant_id",
    timeKey: "created_at",
    dimensions: {
      id: dimension.string(),
      tenantId: dimension.string({ column: "tenant_id" }),
      country: dimension.string({ column: "country_code" }),
      status: dimension.string(),
      amount: dimension.number(),
      customerId: dimension.string({ column: "customer_id" }),
      createdAt: dimension.timestamp({ column: "created_at" }),
      countryUpper: dimension.string({ sql: "upper(country_code)" }),
    },
    measures: {
      revenue: measure.sum("amount"),
      orderCount: measure.count("id"),
      uniqueCustomers: measure.countDistinct("customerId"),
      averageAmount: measure.avg("amount"),
      minAmount: measure.min("amount"),
      maxAmount: measure.max("amount"),
      taxedRevenue: measure.sum("amount", { sql: "amount * 1.2" }),
      completedRevenue: measure.sum("amount", {
        filters: [eq("status", "completed"), gt("amount", 10)],
      }),
    },
    limits: {
      maxResultSize: 500,
    },
  });

  function createSqlBuilderFactory(): QueryBuilderFactoryLike {
    const operatorSql: Record<string, string> = {
      eq: "=",
      neq: "!=",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
      in: "IN",
      notIn: "NOT IN",
      between: "BETWEEN",
      like: "LIKE",
    };

    function createBuilder(source: string): QueryBuilderLike {
      const state = {
        select: [] as string[],
        where: [] as string[],
        groupBy: [] as string[],
        orderBy: [] as string[],
        limit: undefined as number | undefined,
        offset: undefined as number | undefined,
      };

      const renderWhere = (column: string, operator: string) => {
        if (operator === "between") {
          return `${column} BETWEEN ? AND ?`;
        }
        if (operator === "in" || operator === "notIn") {
          return `${column} ${operatorSql[operator]} (?)`;
        }
        return `${column} ${operatorSql[operator] ?? operator} ?`;
      };

      const buildSql = () => [
        `SELECT ${state.select.join(", ")} FROM ${source}`,
        state.where.length > 0 ? `WHERE ${state.where.join(" AND ")}` : "",
        state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.join(", ")}` : "",
        state.orderBy.length > 0 ? `ORDER BY ${state.orderBy.join(", ")}` : "",
        state.limit != null ? `LIMIT ${state.limit}` : "",
        state.offset != null ? `OFFSET ${state.offset}` : "",
      ].filter(Boolean).join(" ");

      const builder: QueryBuilderLike = {
        select: (args: BuilderColumnsInput) => {
          state.select.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        sum: (column: string, alias?: string) => {
          state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
          return builder;
        },
        count: (column: string, alias?: string) => {
          state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
          return builder;
        },
        countDistinct: (column: string, alias?: string) => {
          state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
          return builder;
        },
        avg: (column: string, alias?: string) => {
          state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
          return builder;
        },
        min: (column: string, alias?: string) => {
          state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
          return builder;
        },
        max: (column: string, alias?: string) => {
          state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
          return builder;
        },
        where: (column: string, operator: string, _value: unknown) => {
          state.where.push(renderWhere(column, operator));
          return builder;
        },
        groupBy: (args: BuilderColumnsInput) => {
          state.groupBy.push(...(Array.isArray(args) ? args : [args]));
          return builder;
        },
        orderBy: (column: string, direction?: string) => {
          state.orderBy.push(`${column} ${direction ?? "ASC"}`);
          return builder;
        },
        limit: (count: number) => {
          state.limit = count;
          return builder;
        },
        offset: (count: number) => {
          state.offset = count;
          return builder;
        },
        toSQLWithParams: () => ({ sql: buildSql(), parameters: [] }),
        execute: vi.fn().mockResolvedValue([]),
      };

      return builder;
    }

    return {
      table: createBuilder,
      rawQuery: vi.fn().mockResolvedValue([]),
    };
  }

  it("generates all dataset aggregation types with aliases and custom SQL expressions", () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });
    const sql = analytics.toSQL(MatrixOrders, {
      dimensions: ["country", "countryUpper"],
      measures: [
        "revenue",
        "orderCount",
        "uniqueCustomers",
        "averageAmount",
        "minAmount",
        "maxAmount",
        "taxedRevenue",
      ],
    }, TENANT_CONTEXT);

    expect(sql).toContain("SELECT country_code AS country, upper(country_code) AS countryUpper");
    expect(sql).toContain("SUM(amount) AS revenue");
    expect(sql).toContain("COUNT(id) AS orderCount");
    expect(sql).toContain("COUNT(DISTINCT customer_id) AS uniqueCustomers");
    expect(sql).toContain("AVG(amount) AS averageAmount");
    expect(sql).toContain("MIN(amount) AS minAmount");
    expect(sql).toContain("MAX(amount) AS maxAmount");
    expect(sql).toContain("SUM(amount * 1.2) AS taxedRevenue");
    expect(sql).toContain("GROUP BY country, countryUpper");
  });

  it("generates filtered measures, tenant scoping, time grain, ordering, limit, and offset together", () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });
    const sql = analytics.toSQL(MatrixOrders, {
      dimensions: ["status"],
      measures: ["completedRevenue"],
      by: "month",
      filters: [eq("country", "US")],
      orderBy: [desc("completedRevenue")],
      limit: 50,
      offset: 10,
    }, {
      runtime: {
        tenant: { id: "tenant-1" },
      },
    });

    expect(sql).toContain("toStartOfMonth(created_at) AS period");
    expect(sql).toContain("status");
    expect(sql).toContain("SUM(if((status = 'completed') AND (amount > 10), amount, 0)) AS completedRevenue");
    expect(sql).toContain("WHERE tenant_id = ? AND country_code = ?");
    expect(sql).toContain("GROUP BY period, status");
    expect(sql).toContain("ORDER BY completedRevenue DESC");
    expect(sql).toContain("LIMIT 50 OFFSET 10");
  });

  it("forwards every dataset filter operator through resolved fields", () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });
    const sql = analytics.toSQL(MatrixOrders, {
      dimensions: ["status"],
      measures: ["revenue"],
      filters: [
        neq("status", "cancelled"),
        gt("amount", 10),
        gte("amount", 20),
        lt("amount", 100),
        lte("amount", 200),
        inList("country", ["US", "DE"]),
        notInList("status", ["fraud"]),
        between("createdAt", "2026-01-01", "2026-01-31"),
        like("status", "complete%"),
      ],
    }, TENANT_CONTEXT);

    expect(sql).toContain("status != ?");
    expect(sql).toContain("amount > ?");
    expect(sql).toContain("amount >= ?");
    expect(sql).toContain("amount < ?");
    expect(sql).toContain("amount <= ?");
    expect(sql).toContain("country_code IN (?)");
    expect(sql).toContain("status NOT IN (?)");
    expect(sql).toContain("created_at BETWEEN ? AND ?");
    expect(sql).toContain("status LIKE ?");
  });

  it("validates pagination and dataset max result limits before SQL generation", () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });

    expect(analytics.validate(MatrixOrders, {
      measures: ["revenue"],
      limit: -1,
    }).errors).toContain("Invalid limit: expected a non-negative integer.");

    expect(analytics.validate(MatrixOrders, {
      measures: ["revenue"],
      offset: 1.5,
    }).errors).toContain("Invalid offset: expected a non-negative integer.");

    expect(analytics.validate(MatrixOrders, {
      measures: ["revenue"],
      limit: 501,
    }).errors).toContain("Too many results requested: 501 (max 500)");
  });
});
