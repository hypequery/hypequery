import { describe, it, expect, vi } from 'vitest';
import { dataset } from './dataset.js';
import { field } from './field.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { sum, count, countDistinct, avg, min, max } from './aggregations.js';
import { divide, multiply, subtract, add, nullIfZero, coalesce, round, floor, ceil } from './formulas.js';
import { createDatasetRegistry } from './registry.js';
import { MetricExecutor } from './executor.js';
import type { MetricAdapter } from './executor.js';

// =============================================================================
// TEST FIXTURES
// =============================================================================

const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",
  fields: {
    id: field.string(),
    name: field.string({ label: "Customer Name" }),
    country: field.string({ label: "Country" }),
    createdAt: field.timestamp(),
  },
});

const Orders = dataset("orders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",
  fields: {
    id: field.string(),
    customerId: field.string(),
    country: field.string({ label: "Country" }),
    status: field.string({ label: "Order Status" }),
    amount: field.number({ label: "Amount" }),
    createdAt: field.timestamp({ label: "Created At" }),
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

  it("stores field definitions", () => {
    expect(Orders.fields.amount.__type).toBe("field_definition");
    expect(Orders.fields.amount.fieldType).toBe("number");
    expect(Orders.fields.amount.label).toBe("Amount");
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
    const f = field.string({ label: "Name" });
    expect(f.fieldType).toBe("string");
    expect(f.label).toBe("Name");
  });

  it("creates number field", () => {
    const f = field.number();
    expect(f.fieldType).toBe("number");
    expect(f.label).toBeUndefined();
  });

  it("creates boolean field", () => {
    expect(field.boolean().fieldType).toBe("boolean");
  });

  it("creates timestamp field", () => {
    expect(field.timestamp().fieldType).toBe("timestamp");
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
      value: sum("amount"),
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
    const totalRevenue = Orders.metric("totalRevenue", { value: sum("amount") });
    const orderCount = Orders.metric("orderCount", { value: count("id") });

    const avgOrderValue = Orders.metric("avgOrderValue", {
      uses: { revenue: totalRevenue, orders: orderCount },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
      label: "Average Order Value",
    });

    expect(avgOrderValue.__type).toBe("metric_ref");
    expect(avgOrderValue.spec.__type).toBe("derived_metric_spec");
  });

  it(".by() creates a grained metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { value: sum("amount") });
    const monthly = totalRevenue.by("month");

    expect(monthly.__type).toBe("grained_metric_ref");
    expect(monthly.grain).toBe("month");
    expect(monthly.metric).toBe(totalRevenue);
  });

  it(".by() throws if dataset has no timeKey", () => {
    const m = Customers.metric("count", { value: count("id") });
    expect(() => m.by("month")).toThrow("no timeKey");
  });
});

// =============================================================================
// CONTRACT TESTS
// =============================================================================

describe("metric.contract()", () => {
  it("returns contract for a base metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", {
      value: sum("amount"),
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
    const totalRevenue = Orders.metric("totalRevenue", { value: sum("amount") });
    const orderCount = Orders.metric("orderCount", { value: count("id") });
    const avgOV = Orders.metric("avgOrderValue", {
      uses: { revenue: totalRevenue, orders: orderCount },
      formula: ({ revenue, orders }) => divide(revenue, nullIfZero(orders)),
    });

    const contract = avgOV.contract();
    expect(contract.kind).toBe("derived_metric");
    expect(contract.requires).toEqual(["revenue", "orders"]);
  });

  it("returns contract for a grained metric", () => {
    const totalRevenue = Orders.metric("totalRevenue", { value: sum("amount") });
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
  function createMockAdapter(): MetricAdapter {
    return {
      rawQuery: vi.fn().mockResolvedValue([]),
    };
  }

  const totalRevenue = Orders.metric("totalRevenue", {
    value: sum("amount"),
    label: "Total Revenue",
  });
  const orderCount = Orders.metric("orderCount", { value: count("id") });
  const avgOrderValue = Orders.metric("avgOrderValue", {
    uses: { totalRevenue, orderCount },
    formula: ({ totalRevenue, orderCount }) =>
      divide(totalRevenue, nullIfZero(orderCount)),
  });

  describe("toSQL() — base metrics", () => {
    it("generates simple aggregate SQL", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
      });

      expect(sql).toContain("SELECT country, SUM(amount) AS totalRevenue FROM orders");
      expect(sql).toContain("GROUP BY country");
    });

    it("injects tenant WHERE clause", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
      }, { tenantId: "t1" });

      expect(sql).toContain("WHERE tenant_id = ?");
    });

    it("applies user filters", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
        filters: [{ field: "status", operator: "eq", value: "completed" }],
      });

      expect(sql).toContain("status = ?");
    });

    it("applies ORDER BY and LIMIT", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "totalRevenue", direction: "desc" }],
        limit: 100,
      });

      expect(sql).toContain("ORDER BY totalRevenue DESC");
      expect(sql).toContain("LIMIT 100");
    });
  });

  describe("toSQL() — grained metrics", () => {
    it("generates time-grained SQL with .by()", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const monthly = totalRevenue.by("month");
      const sql = executor.toSQL(monthly);

      expect(sql).toContain("toStartOfMonth(created_at) AS period");
      expect(sql).toContain("GROUP BY period");
      expect(sql).toContain("ORDER BY period");
    });

    it("supports grain via query.by", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(totalRevenue, { by: "week" });

      expect(sql).toContain("toStartOfWeek(created_at) AS period");
    });
  });

  describe("toSQL() — derived metrics", () => {
    it("generates CTE-based SQL", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const sql = executor.toSQL(avgOrderValue, {
        dimensions: ["country"],
      });

      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("SUM(amount) AS totalRevenue");
      expect(sql).toContain("COUNT(id) AS orderCount");
      expect(sql).toContain("FROM base");
      expect(sql).toContain("(totalRevenue) / (NULLIF(orderCount, 0)) AS avgOrderValue");
    });
  });

  describe("run()", () => {
    it("executes SQL and returns MetricResult", async () => {
      const adapter = createMockAdapter();
      (adapter.rawQuery as ReturnType<typeof vi.fn>).mockResolvedValue([
        { country: "US", totalRevenue: 1000 },
      ]);

      const executor = new MetricExecutor({ adapter });
      const result = await executor.run(totalRevenue, {
        dimensions: ["country"],
      });

      expect(result.data).toEqual([{ country: "US", totalRevenue: 1000 }]);
      expect(result.meta.sql).toBeDefined();
      expect(result.meta.timingMs).toBeGreaterThanOrEqual(0);
    });

    it("passes tenant context to SQL", async () => {
      const adapter = createMockAdapter();
      const executor = new MetricExecutor({ adapter });

      await executor.run(totalRevenue, {}, { tenantId: "t1" });

      expect(adapter.rawQuery).toHaveBeenCalledWith(
        expect.stringContaining("tenant_id = ?"),
        ["t1"],
      );
    });
  });

  describe("validate()", () => {
    it("accepts valid queries", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["country", "status"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects unknown dimensions", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["nonexistent"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown dimension");
    });

    it("rejects unknown filter fields", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "nonexistent", operator: "eq", value: "x" }],
      });
      expect(result.valid).toBe(false);
    });

    it("rejects exceeding dimension limits", () => {
      const executor = new MetricExecutor({ adapter: createMockAdapter() });
      const result = executor.validate(totalRevenue, {
        dimensions: ["id", "customerId", "country", "status", "amount", "createdAt"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Too many dimensions");
    });
  });
});
