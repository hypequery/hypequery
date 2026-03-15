import { describe, it, expect, vi } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset } from './dataset.js';
import { field } from './field.js';
import { sum, count } from './aggregations.js';
import { divide, nullIfZero } from './formulas.js';
import { defineMetrics } from './define-metrics.js';
import { defineDatasets } from './define-datasets.js';
import type { QueryBuilderLike, QueryBuilderFactoryLike } from './query-builder-protocol.js';
import type { ServeRequest } from '../../types.js';

// =============================================================================
// FIXTURES
// =============================================================================

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
    createdAt: field.timestamp(),
  },
  limits: {
    maxDimensions: 5,
  },
});

const Customers = dataset("customers", {
  source: "customers",
  tenantKey: "tenant_id",
  fields: {
    id: field.string(),
    name: field.string({ label: "Customer Name" }),
    tier: field.string({ label: "Tier" }),
  },
});

const totalRevenue = Orders.metric("totalRevenue", {
  value: sum("amount"),
  label: "Total Revenue",
});

const orderCount = Orders.metric("orderCount", {
  value: count("id"),
  label: "Order Count",
});

const avgOrderValue = Orders.metric("avgOrderValue", {
  uses: { totalRevenue, orderCount },
  formula: ({ totalRevenue, orderCount }) =>
    divide(totalRevenue, nullIfZero(orderCount)),
  label: "Average Order Value",
});

const BASE_PATH = "/api/analytics";

function createRequest(overrides: Partial<ServeRequest> = {}): ServeRequest {
  const path = overrides.path ?? "/";
  const normalized = path.startsWith(BASE_PATH)
    ? path
    : `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
  return {
    method: overrides.method ?? "POST",
    headers: overrides.headers ?? { 'content-type': 'application/json' },
    query: overrides.query ?? {},
    ...overrides,
    path: normalized,
  };
}

function createMockBuilderFactory(): QueryBuilderFactoryLike & { _calls: Record<string, any[][]> } {
  const calls: Record<string, any[][]> = {};
  const track = (name: string, ...args: any[]) => {
    calls[name] = calls[name] || [];
    calls[name].push(args);
  };

  const mockData = [
    { country: "US", totalRevenue: 5000 },
    { country: "DE", totalRevenue: 3000 },
  ];

  function createMockBuilder(): QueryBuilderLike {
    const builder: QueryBuilderLike = {
      select: (...args: any[]) => { track('select', ...args); return builder; },
      sum: (...args: any[]) => { track('sum', ...args); return builder; },
      count: (...args: any[]) => { track('count', ...args); return builder; },
      countDistinct: (...args: any[]) => { track('countDistinct', ...args); return builder; },
      avg: (...args: any[]) => { track('avg', ...args); return builder; },
      min: (...args: any[]) => { track('min', ...args); return builder; },
      max: (...args: any[]) => { track('max', ...args); return builder; },
      where: (...args: any[]) => { track('where', ...args); return builder; },
      groupBy: (...args: any[]) => { track('groupBy', ...args); return builder; },
      orderBy: (...args: any[]) => { track('orderBy', ...args); return builder; },
      limit: (...args: any[]) => { track('limit', ...args); return builder; },
      offset: (...args: any[]) => { track('offset', ...args); return builder; },
      toSQLWithParams: () => ({
        sql: 'SELECT * FROM orders',
        parameters: [],
      }),
      execute: vi.fn().mockResolvedValue(mockData),
    };
    return builder;
  }

  return {
    _calls: calls,
    table: (name: string) => { track('table', name); return createMockBuilder(); },
    rawQuery: vi.fn().mockResolvedValue(mockData),
  };
}

// =============================================================================
// defineMetrics TESTS
// =============================================================================

describe("defineMetrics()", () => {
  it("returns a MetricsBlock with __type", () => {
    const factory = createMockBuilderFactory();
    const block = defineMetrics(factory, { totalRevenue });

    expect(block.__type).toBe('metrics_block');
    expect(block.entries).toHaveProperty('totalRevenue');
    expect(block.builderFactory).toBe(factory);
  });

  it("preserves block-level defaults", () => {
    const factory = createMockBuilderFactory();
    const block = defineMetrics(factory, { totalRevenue }, { cache: 60_000 });

    expect(block.defaults?.cache).toBe(60_000);
  });

  it("works with createAPI — basic metric endpoint", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue });

    const api = createAPI({ metrics });

    const response = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: { dimensions: ["country"] },
      })
    );

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual([
      { country: "US", totalRevenue: 5000 },
      { country: "DE", totalRevenue: 3000 },
    ]);
  });

  it("does not require global queryBuilder when using defineMetrics block", () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue });

    // Should NOT throw — block carries its own builder factory
    expect(() => createAPI({ metrics })).not.toThrow();
  });

  it("applies block-level cache defaults to shorthand entries", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue }, { cache: 60_000 });

    const api = createAPI({ metrics });
    const description = api.describe();
    const metricEndpoint = description.queries.find(q => q.tags.includes("metrics"));

    expect(metricEndpoint).toBeDefined();
  });

  it("supports per-metric overrides within the block", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, {
      totalRevenue,
      orderCount: {
        metric: orderCount,
        cache: 300_000,
      },
    });

    const api = createAPI({ metrics });

    const r1 = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: {},
      })
    );
    expect(r1.status).toBe(200);

    const r2 = await api.handler(
      createRequest({
        path: "/metrics/orderCount",
        method: "POST",
        body: {},
      })
    );
    expect(r2.status).toBe(200);
  });

  it("works alongside manual queries", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue });

    const api = createAPI({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
      metrics,
    });

    // Queries need explicit route registration
    api.route("/ping", api.queries.ping);

    const metricResponse = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: {},
      })
    );
    expect(metricResponse.status).toBe(200);

    const pingResponse = await api.handler(
      createRequest({
        path: "/ping",
        method: "GET",
      })
    );
    expect(pingResponse.status).toBe(200);
  });

  it("validates dimensions against metric contract", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue });
    const api = createAPI({ metrics });

    const response = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: { dimensions: ["nonexistent_field"] },
      })
    );

    expect(response.status).toBe(400);
  });

  it("backwards compat: inline metrics config still works", async () => {
    const factory = createMockBuilderFactory();

    const api = createAPI({
      metrics: { totalRevenue },
      queryBuilder: factory,
    });

    const response = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: {},
      })
    );

    expect(response.status).toBe(200);
  });
});

// =============================================================================
// defineDatasets TESTS
// =============================================================================

describe("defineDatasets()", () => {
  it("returns a DatasetsBlock with __type", () => {
    const factory = createMockBuilderFactory();
    const block = defineDatasets(factory, { orders: Orders });

    expect(block.__type).toBe('datasets_block');
    expect(block.entries).toHaveProperty('orders');
    expect(block.builderFactory).toBe(factory);
  });

  it("preserves block-level defaults", () => {
    const factory = createMockBuilderFactory();
    const block = defineDatasets(factory, { orders: Orders }, { maxLimit: 500 });

    expect(block.defaults?.maxLimit).toBe(500);
  });

  it("works with createAPI — dataset browse endpoint", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });

    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: { columns: ["country", "amount"] },
      })
    );

    expect(response.status).toBe(200);
    expect((response.body as any).data).toBeDefined();
    expect(Array.isArray((response.body as any).data)).toBe(true);
  });

  it("does not require global queryBuilder when using defineDatasets block", () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });

    expect(() => createAPI({ datasets })).not.toThrow();
  });

  it("validates columns against dataset fields", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: { columns: ["nonexistent_column"] },
      })
    );

    expect(response.status).toBe(400);
    expect((response.body as any).error.type).toBe("VALIDATION_ERROR");
  });

  it("validates filter fields against dataset fields", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {
          filters: [{ field: "nonexistent", operator: "eq", value: "x" }],
        },
      })
    );

    expect(response.status).toBe(400);
  });

  it("selects all fields by default when no columns specified", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
      })
    );

    expect(factory._calls['select']).toBeDefined();
    const selectedColumns = factory._calls['select'][0][0];
    expect(selectedColumns).toEqual(expect.arrayContaining(['id', 'customerId', 'country', 'status', 'amount', 'createdAt']));
  });

  it("passes filters through builder.where()", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {
          filters: [{ field: "status", operator: "eq", value: "completed" }],
        },
      })
    );

    expect(factory._calls['where']).toBeDefined();
    expect(factory._calls['where'][0]).toEqual(['status', 'eq', 'completed']);
  });

  it("applies order/limit/offset via builder methods", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {
          orderBy: [{ field: "amount", direction: "desc" }],
          limit: 50,
          offset: 10,
        },
      })
    );

    expect(factory._calls['orderBy']).toBeDefined();
    expect(factory._calls['orderBy'][0]).toEqual(['amount', 'DESC']);
    expect(factory._calls['limit']).toBeDefined();
    expect(factory._calls['limit'][0]).toEqual([50]);
    expect(factory._calls['offset']).toBeDefined();
    expect(factory._calls['offset'][0]).toEqual([10]);
  });

  it("clamps limit to maxLimit", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders }, { maxLimit: 100 });
    const api = createAPI({ datasets });

    await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: { limit: 99999 },
      })
    );

    expect(factory._calls['limit']).toBeDefined();
    expect(factory._calls['limit'][0]).toEqual([100]);
  });

  it("injects tenant filter when tenant is configured", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });

    const api = createAPI({
      datasets,
      auth: async ({ request }) => {
        const key = request.headers['x-api-key'];
        if (key === 'valid') return { tenantId: 'tenant-123' };
        return null;
      },
      tenant: {
        extract: (auth) => auth.tenantId as string,
        required: true,
      },
    });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'valid',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(factory._calls['where']).toBeDefined();
    expect(factory._calls['where'][0]).toEqual(['tenant_id', 'eq', 'tenant-123']);
  });

  it("returns meta when x-include-meta header is set", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
        headers: {
          'content-type': 'application/json',
          'x-include-meta': 'true',
        },
      })
    );

    expect(response.status).toBe(200);
    expect((response.body as any).meta).toBeDefined();
    expect((response.body as any).meta.sql).toBeDefined();
  });

  it("supports multiple datasets", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, {
      orders: Orders,
      customers: Customers,
    });
    const api = createAPI({ datasets });

    const r1 = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
      })
    );
    expect(r1.status).toBe(200);

    const r2 = await api.handler(
      createRequest({
        path: "/datasets/customers/query",
        method: "POST",
        body: {},
      })
    );
    expect(r2.status).toBe(200);
  });

  it("returns 404 for unknown dataset", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/datasets/nonexistent/query",
        method: "POST",
        body: {},
      })
    );

    expect(response.status).toBe(404);
  });

  it("works alongside metrics and queries", async () => {
    const factory = createMockBuilderFactory();
    const metrics = defineMetrics(factory, { totalRevenue });
    const datasets = defineDatasets(factory, { orders: Orders });

    const api = createAPI({
      queries: { ping: { query: async () => ({ ok: true }) } },
      metrics,
      datasets,
    });

    // Queries need explicit route registration
    api.route("/ping", (api.queries as any).ping);

    const metricResponse = await api.handler(
      createRequest({
        path: "/metrics/totalRevenue",
        method: "POST",
        body: {},
      })
    );
    expect(metricResponse.status).toBe(200);

    const datasetResponse = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
      })
    );
    expect(datasetResponse.status).toBe(200);

    const pingResponse = await api.handler(
      createRequest({
        path: "/ping",
        method: "GET",
      })
    );
    expect(pingResponse.status).toBe(200);
  });

  it("includes dataset endpoints in OpenAPI spec", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders });
    const api = createAPI({ datasets });

    const response = await api.handler(
      createRequest({
        path: "/openapi.json",
        method: "GET",
      })
    );

    expect(response.status).toBe(200);
    const doc = response.body as any;
    const datasetPath = Object.keys(doc.paths).find(p => p.includes("orders"));
    expect(datasetPath).toBeDefined();
  });

  it("includes dataset endpoints in describe()", () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, { orders: Orders, customers: Customers });
    const api = createAPI({ datasets });

    const description = api.describe();
    const datasetEndpoints = description.queries.filter(q => q.tags.includes("datasets"));
    expect(datasetEndpoints.length).toBe(2);
  });

  it("per-dataset overrides in expanded form", async () => {
    const factory = createMockBuilderFactory();
    const datasets = defineDatasets(factory, {
      orders: {
        dataset: Orders,
        cache: 120_000,
        maxLimit: 50,
      },
    });
    const api = createAPI({ datasets });

    await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: { limit: 999 },
      })
    );

    // maxLimit should clamp to 50
    expect(factory._calls['limit']).toBeDefined();
    expect(factory._calls['limit'][0]).toEqual([50]);
  });

  it("backwards compat: inline datasets config with global queryBuilder", async () => {
    const factory = createMockBuilderFactory();

    const api = createAPI({
      datasets: { orders: Orders },
      queryBuilder: factory,
    });

    const response = await api.handler(
      createRequest({
        path: "/datasets/orders/query",
        method: "POST",
        body: {},
      })
    );

    expect(response.status).toBe(200);
  });

  it("throws if inline datasets without queryBuilder", () => {
    expect(() =>
      createAPI({
        datasets: { orders: Orders },
      })
    ).toThrow("queryBuilder");
  });
});
