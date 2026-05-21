import { describe, it, expect, vi } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { sum, count, countDistinct, avg, min, max } from './aggregations.js';
import { divide, multiply, subtract, add, nullIfZero, coalesce, round, floor, ceil } from './formulas.js';
import { eq, between, desc } from './query-helpers.js';
import { measure } from './measure.js';
import { createDatasetRegistry } from './registry.js';
import { MetricExecutor } from './executor.js';
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
// METRIC EXECUTOR TESTS
// =============================================================================

describe("MetricExecutor", () => {
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
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
      });

      expect(sql).toContain("SELECT country, SUM(amount) AS totalRevenue FROM orders");
      expect(sql).toContain("GROUP BY country");
    });

    it("injects tenant WHERE clause", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
      }, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      expect(sql).toContain("WHERE tenant_id = ?");
    });

    it("applies user filters", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
        filters: [{ field: "status", operator: "eq", value: "completed" }],
      });

      expect(sql).toContain("status = ?");
    });

    it("applies ORDER BY and LIMIT", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "totalRevenue", direction: "desc" }],
        limit: 100,
      });

      expect(sql).toContain("ORDER BY totalRevenue DESC");
      expect(sql).toContain("LIMIT 100");
    });

    it("compiles filtered measures into aggregation expressions", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(completedRevenue, {
        dimensions: ["country"],
      });

      expect(sql).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
      expect(sql).toContain("GROUP BY country");
    });

    it("resolves column aliases for countDistinct metrics", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(uniqueCustomers, {
        dimensions: ["country"],
      });

      expect(sql).toContain("COUNT(DISTINCT customer_id) AS uniqueCustomers");
      expect(sql).not.toContain("COUNT(DISTINCT customerId)");
    });
  });

  describe("toSQL() — grained metrics", () => {
    it("generates time-grained SQL with .by()", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const monthly = totalRevenue.by("month");
      const sql = executor.toSQL(monthly);

      expect(sql).toContain("toStartOfMonth(created_at) AS period");
      expect(sql).toContain("GROUP BY period");
      expect(sql).toContain("ORDER BY period");
    });

    it("supports grain via query.by", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(totalRevenue, { by: "week" });

      expect(sql).toContain("toStartOfWeek(created_at) AS period");
    });

    it("rejects conflicting query.by on grained metrics", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const monthly = totalRevenue.by("month");
      const result = executor.validate(monthly, { by: "week" });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('already grained by "month"');
    });
  });

  describe("toSQL() — derived metrics", () => {
    it("generates CTE-based SQL", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(avgOrderValue, {
        dimensions: ["country"],
      });

      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("SUM(amount) AS totalRevenue");
      expect(sql).toContain("COUNT(id) AS orderCount");
      expect(sql).toContain("FROM base");
      expect(sql).toContain("(totalRevenue) / (NULLIF(orderCount, 0)) AS avgOrderValue");
      expect(sql).not.toContain("SELECT country, (totalRevenue) / (NULLIF(orderCount, 0)) AS avgOrderValue, totalRevenue, orderCount FROM base");
    });

    it("does not emit GROUP BY for ungrouped derived metrics", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const sql = executor.toSQL(avgOrderValue);

      expect(sql).toContain("WITH base AS");
      expect(sql).not.toContain("GROUP BY totalRevenue");
      expect(sql).not.toContain("GROUP BY orderCount");
    });

    it("rejects derived plans that introduce aggregate aliases into GROUP BY", () => {
      const executor = new MetricExecutor({ builderFactory: createBrokenDerivedGroupingBuilderFactory() });
      const result = executor.validate(avgOrderValue, {});

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("GROUP BY");
    });
  });

  describe("run()", () => {
    it("executes SQL and returns MetricResult", async () => {
      const builderFactory = createMockBuilderFactory();
      const executor = new MetricExecutor({ builderFactory });
      const result = await executor.run(totalRevenue, {
        dimensions: ["country"],
      });

      expect(result.data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
      expect(result.meta.sql).toBeDefined();
      expect(result.meta.timingMs).toBeGreaterThanOrEqual(0);
    });

    it("passes tenant context to SQL", async () => {
      const builderFactory = createMockBuilderFactory();
      const executor = new MetricExecutor({ builderFactory });

      await executor.run(totalRevenue, {}, {
        runtime: {
          tenant: { id: "t1" },
        },
      });

      // Verify the SQL was generated (toSQL includes tenant filter)
      const sql = executor.toSQL(totalRevenue, {}, {
        runtime: {
          tenant: { id: "t1" },
        },
      });
      expect(sql).toContain("tenant_id");
    });
  });

  describe("validate()", () => {
    it("accepts valid queries", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["country", "status"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects unknown dimensions", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["nonexistent"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown dimension");
    });

    it("rejects unknown filter fields", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "nonexistent", operator: "eq", value: "x" }],
      });
      expect(result.valid).toBe(false);
    });

    it("rejects incompatible filter values", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "eq", value: "not-a-number" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a number value');
    });

    it("rejects empty arrays for in/notIn filters", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "status", operator: "in", value: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a non-empty array');
    });

    it("rejects malformed between filters", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "between", value: [1] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"between" expects a two-item array');
    });

    it("rejects like on numeric fields", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "like", value: "%100%" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"like" is only supported');
    });

    it("rejects unknown orderBy fields", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "amount", direction: "desc" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown orderBy field");
    });

    it("rejects exceeding dimension limits", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["id", "customerId", "country", "status", "amount", "createdAt"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Too many dimensions");
    });

    it("rejects explicit tenant filters when runtime tenancy is active", () => {
      const executor = new MetricExecutor({ builderFactory: createMockBuilderFactory() });
      const result = executor.validate(totalRevenue, {
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
