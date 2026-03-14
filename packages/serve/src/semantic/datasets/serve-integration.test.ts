import { describe, it, expect, vi } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import { dataset } from './dataset.js';
import { field } from './field.js';
import { sum, count, countDistinct } from './aggregations.js';
import { divide, nullIfZero } from './formulas.js';
import type { MetricAdapter } from './executor.js';
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
});
