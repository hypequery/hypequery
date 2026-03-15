import { describe, it, expect, vi } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset } from './dataset.js';
import { field } from './field.js';
import { sum, count, countDistinct } from './aggregations.js';
import { divide, nullIfZero } from './formulas.js';
import type { MetricAdapter } from './executor.js';
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

const totalRevenue = Orders.metric("totalRevenue", {
  value: sum("amount"),
  label: "Total Revenue",
  description: "Sum of all order amounts",
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

function createMockAdapter(): MetricAdapter {
  return {
    rawQuery: vi.fn().mockResolvedValue([
      { country: "US", totalRevenue: 5000 },
      { country: "DE", totalRevenue: 3000 },
    ]),
  };
}

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

// =============================================================================
// TESTS
// =============================================================================

describe("Serve integration — metrics", () => {
  describe("createAPI with metrics", () => {
    it("throws if metricAdapter is missing when metrics are provided", () => {
      expect(() =>
        createAPI({
          metrics: { totalRevenue },
        })
      ).toThrow("metricAdapter");
    });

    it("creates API with metric endpoints", () => {
      const api = createAPI({
        metrics: { totalRevenue, orderCount },
        metricAdapter: createMockAdapter(),
      });

      expect(api).toBeDefined();
      expect(api.handler).toBeDefined();
    });

    it("creates API with both queries and metrics", () => {
      const api = createAPI({
        queries: {
          ping: { query: async () => ({ ok: true }) },
        },
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      expect(api).toBeDefined();
    });
  });

  describe("metric endpoints", () => {
    it("responds to POST /metrics/:name", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: adapter,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("data");
      expect((response.body as any).data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
    });

    it("returns 404 for unknown metric", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/nonexistent",
          method: "POST",
          body: {},
        })
      );

      expect(response.status).toBe(404);
    });

    it("returns 400 for invalid dimensions", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["nonexistent_field"] },
        })
      );

      expect(response.status).toBe(400);
      expect((response.body as any).error.type).toBe("VALIDATION_ERROR");
    });

    it("passes dimensions and filters to the executor", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: adapter,
      });

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {
            dimensions: ["country"],
            filters: [{ field: "status", operator: "eq", value: "completed" }],
            orderBy: [{ field: "totalRevenue", direction: "desc" }],
            limit: 10,
          },
        })
      );

      expect(adapter.rawQuery).toHaveBeenCalled();
      const sql = (adapter.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("country");
      expect(sql).toContain("SUM(amount)");
      expect(sql).toContain("status = ?");
      expect(sql).toContain("LIMIT 10");
    });

    it("supports time graining via body.by", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: adapter,
      });

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { by: "month" },
        })
      );

      const sql = (adapter.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("toStartOfMonth");
      expect(sql).toContain("period");
    });

    it("works with derived metrics", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { avgOrderValue },
        metricAdapter: adapter,
      });

      await api.handler(
        createRequest({
          path: "/metrics/avgOrderValue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      const sql = (adapter.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("NULLIF(orderCount, 0)");
    });
  });

  describe("meta / envelope", () => {
    it("excludes meta by default", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
        })
      );

      expect((response.body as any).meta).toBeUndefined();
    });

    it("includes meta when X-Include-Meta header is set", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect((response.body as any).meta).toBeDefined();
      expect((response.body as any).meta.sql).toBeDefined();
    });
  });

  describe("tenant injection", () => {
    it("injects tenant ID into metric queries when tenant config is provided", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: adapter,
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
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"] },
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(200);
      const sql = (adapter.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("tenant_id = ?");
    });
  });

  describe("per-metric overrides", () => {
    it("accepts shorthand metric entry", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
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

    it("accepts expanded metric entry with overrides", async () => {
      const api = createAPI({
        metrics: {
          totalRevenue: {
            metric: totalRevenue,
            cache: 60_000,
          },
        },
        metricAdapter: createMockAdapter(),
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

    it("applies per-metric auth", async () => {
      const api = createAPI({
        metrics: {
          totalRevenue: {
            metric: totalRevenue,
            auth: async () => null, // always reject
          },
        },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
        })
      );

      expect(response.status).toBe(401);
    });
  });

  describe("OpenAPI", () => {
    it("includes metric endpoints in OpenAPI spec", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      const response = await api.handler(
        createRequest({
          path: "/openapi.json",
          method: "GET",
        })
      );

      expect(response.status).toBe(200);
      const doc = response.body as any;
      const metricPath = Object.keys(doc.paths).find(p => p.includes("totalRevenue"));
      expect(metricPath).toBeDefined();
      expect(doc.paths[metricPath!].post).toBeDefined();
    });
  });

  describe("describe()", () => {
    it("includes metric endpoints in describe output", () => {
      const api = createAPI({
        metrics: { totalRevenue, orderCount },
        metricAdapter: createMockAdapter(),
      });

      const description = api.describe();
      const metricEndpoints = description.queries.filter(q => q.tags.includes("metrics"));
      expect(metricEndpoints.length).toBe(2);
    });
  });

  describe("queryLogger", () => {
    it("emits events for metric endpoint execution", async () => {
      const events: any[] = [];
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: createMockAdapter(),
      });

      api.queryLogger.on((event) => events.push(event));

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
        })
      );

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events[0].status).toBe("started");
      expect(events[events.length - 1].status).toBe("completed");
    });
  });

  // ===========================================================================
  // queryBuilder path (new)
  // ===========================================================================

  describe("queryBuilder config path", () => {
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
            sql: 'SELECT country, SUM(amount) AS totalRevenue FROM orders GROUP BY country',
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

    it("creates API with queryBuilder instead of metricAdapter", () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

      expect(api).toBeDefined();
      expect(api.handler).toBeDefined();
    });

    it("throws if neither queryBuilder nor metricAdapter is provided", () => {
      expect(() =>
        createAPI({ metrics: { totalRevenue } })
      ).toThrow("queryBuilder");
    });

    it("executes base metric queries via builder.execute()", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

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

      // Builder methods should have been called
      expect(factory._calls['table']).toBeDefined();
      expect(factory._calls['table'][0]).toEqual(['orders']);
      expect(factory._calls['sum']).toBeDefined();
      expect(factory._calls['sum'][0]).toEqual(['amount', 'totalRevenue']);
    });

    it("passes filters through builder.where()", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {
            dimensions: ["country"],
            filters: [{ field: "status", operator: "eq", value: "completed" }],
          },
        })
      );

      expect(factory._calls['where']).toBeDefined();
      expect(factory._calls['where'][0]).toEqual(['status', 'eq', 'completed']);
    });

    it("applies time graining via builder.select() with grain function", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { by: "month" },
        })
      );

      // Should select with toStartOfMonth expression
      expect(factory._calls['select']).toBeDefined();
      const selectArgs = factory._calls['select'][0][0];
      expect(selectArgs).toContain('toStartOfMonth(created_at) AS period');
    });

    it("applies order/limit/offset via builder methods", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

      await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {
            orderBy: [{ field: "totalRevenue", direction: "desc" }],
            limit: 10,
            offset: 5,
          },
        })
      );

      expect(factory._calls['orderBy']).toBeDefined();
      expect(factory._calls['orderBy'][0]).toEqual(['totalRevenue', 'DESC']);
      expect(factory._calls['limit']).toBeDefined();
      expect(factory._calls['limit'][0]).toEqual([10]);
      expect(factory._calls['offset']).toBeDefined();
      expect(factory._calls['offset'][0]).toEqual([5]);
    });

    it("injects tenant filter via builder.where()", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
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
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"] },
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(200);
      // tenant filter should go through builder.where()
      expect(factory._calls['where']).toBeDefined();
      expect(factory._calls['where'][0]).toEqual(['tenant_id', 'eq', 'tenant-123']);
    });

    it("handles derived metrics via builder for CTE + rawQuery for outer", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { avgOrderValue },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/avgOrderValue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      expect(response.status).toBe(200);
      // Derived metrics fall back to rawQuery for the outer CTE query
      expect(factory.rawQuery).toHaveBeenCalled();
      const sql = (factory.rawQuery as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("NULLIF(orderCount, 0)");
    });

    it("legacy metricAdapter still works", async () => {
      const adapter = createMockAdapter();
      const api = createAPI({
        metrics: { totalRevenue },
        metricAdapter: adapter,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      expect(response.status).toBe(200);
      expect(adapter.rawQuery).toHaveBeenCalled();
    });
  });
});
