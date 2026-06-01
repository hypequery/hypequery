import { describe, it, expect } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { belongsTo, hasMany, hasOne } from './relationships.js';
import { sum, count, countDistinct, avg, min, max } from './aggregations.js';
import { divide, multiply, subtract, add, nullIfZero, coalesce, round, floor, ceil } from './formulas.js';
import { eq, between, desc } from './query-helpers.js';
import { measure } from './measure.js';
import { createDatasetRegistry } from './registry.js';
import { createExecutor } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';

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

describe("dataset query validation", () => {
  const executor = createExecutor({
    backend: createInMemoryBackend({ orders: [] }),
  });

  it("rejects explicit tenant filters under runtime tenancy", () => {
    const validation = executor.validateDataset(Orders, {
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

  it("accepts valid dataset queries", () => {
    const validation = executor.validateDataset(Orders, {
      dimensions: ['status'],
      measures: ['completedRevenue'],
      filters: [eq('country', 'ES')],
      orderBy: [desc('completedRevenue')],
      limit: 5,
    });

    expect(validation.valid).toBe(true);
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
    expect(divide("a", "b").expression).toEqual({
      kind: 'binary',
      operator: 'divide',
      left: { kind: 'ref', name: 'a' },
      right: { kind: 'ref', name: 'b' },
    });
  });

  it("multiply", () => {
    expect(multiply("a", "b").expression).toMatchObject({ kind: 'binary', operator: 'multiply' });
  });

  it("subtract", () => {
    expect(subtract("a", "b").expression).toMatchObject({ kind: 'binary', operator: 'subtract' });
  });

  it("add", () => {
    expect(add("a", "b").expression).toMatchObject({ kind: 'binary', operator: 'add' });
  });

  it("nullIfZero", () => {
    expect(nullIfZero("x").expression).toEqual({
      kind: 'function',
      name: 'nullIfZero',
      args: [{ kind: 'ref', name: 'x' }],
    });
  });

  it("coalesce", () => {
    expect(coalesce("x", 0).expression).toEqual({
      kind: 'function',
      name: 'coalesce',
      args: [{ kind: 'ref', name: 'x' }, { kind: 'literal', value: 0 }],
    });
  });

  it("round", () => {
    expect(round("x", 2).expression).toMatchObject({ kind: 'function', name: 'round' });
  });

  it("floor", () => {
    expect(floor("x").expression).toMatchObject({ kind: 'function', name: 'floor' });
  });

  it("ceil", () => {
    expect(ceil("x").expression).toMatchObject({ kind: 'function', name: 'ceil' });
  });

  it("composes nested expression trees", () => {
    expect(divide("revenue", nullIfZero("orders")).expression).toEqual({
      kind: 'binary',
      operator: 'divide',
      left: { kind: 'ref', name: 'revenue' },
      right: {
        kind: 'function',
        name: 'nullIfZero',
        args: [{ kind: 'ref', name: 'orders' }],
      },
    });
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
// SEMANTIC EXECUTOR TESTS
// =============================================================================

describe("SemanticExecutor", () => {
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

  describe("createExecutor()", () => {
    it("can execute semantic plans against an in-memory backend without a query builder", async () => {
      const executor = createExecutor({
        backend: createInMemoryBackend({
          orders: [
            { id: "1", tenant_id: "t1", country: "US", status: "completed", amount: 100, created_at: "2026-01-02" },
            { id: "2", tenant_id: "t1", country: "US", status: "pending", amount: 50, created_at: "2026-01-03" },
            { id: "3", tenant_id: "t1", country: "DE", status: "completed", amount: 75, created_at: "2026-01-04" },
            { id: "4", tenant_id: "t2", country: "US", status: "completed", amount: 999, created_at: "2026-01-05" },
          ],
        }),
      });

      const result = await executor.metric(avgOrderValue, {
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

      const datasetResult = await executor.dataset(Orders, {
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
  });

  describe("validate()", () => {
    const executor = createExecutor({
      backend: createInMemoryBackend({ orders: [] }),
    });

    it("accepts valid queries", () => {
      const result = executor.validate(totalRevenue, {
        dimensions: ["country", "status"],
      });
      expect(result.valid).toBe(true);
    });

    it("rejects unknown dimensions", () => {
      const result = executor.validate(totalRevenue, {
        dimensions: ["nonexistent"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown dimension");
    });

    it("rejects unknown filter fields", () => {
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "nonexistent", operator: "eq", value: "x" }],
      });
      expect(result.valid).toBe(false);
    });

    it("rejects incompatible filter values", () => {
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "eq", value: "not-a-number" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a number value');
    });

    it("rejects empty arrays for in/notIn filters", () => {
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "status", operator: "in", value: [] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('expects a non-empty array');
    });

    it("rejects malformed between filters", () => {
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "between", value: [1] }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"between" expects a two-item array');
    });

    it("rejects like on numeric fields", () => {
      const result = executor.validate(totalRevenue, {
        filters: [{ field: "amount", operator: "like", value: "%100%" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('"like" is only supported');
    });

    it("rejects unknown orderBy fields", () => {
      const result = executor.validate(totalRevenue, {
        dimensions: ["country"],
        orderBy: [{ field: "amount", direction: "desc" }],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown orderBy field");
    });

    it("rejects exceeding dimension limits", () => {
      const result = executor.validate(totalRevenue, {
        dimensions: ["id", "customerId", "country", "status", "amount", "createdAt"],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Too many dimensions");
    });

    it("rejects explicit tenant filters when runtime tenancy is active", () => {
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
