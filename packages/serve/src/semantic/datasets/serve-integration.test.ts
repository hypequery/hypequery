import { describe, it, expect, vi, afterEach } from 'vitest';
import { createAPI } from '../../server/create-api.js';
import {
  dataset,
  dimension,
  measure,
  divide,
  nullIfZero,
  type QueryBuilderLike,
  type QueryBuilderFactoryLike,
} from '@hypequery/datasets';
import { MetricQueryEngine } from '@hypequery/datasets/internal';
import type { ServeRequest } from '../../types.js';
import type { ServeQueryEvent } from '../../query-logger.js';

// =============================================================================
// FIXTURES
// =============================================================================

const Orders = dataset("orders", {
  source: "orders",
  timeKey: "created_at",
  dimensions: {
    id: dimension.string(),
    customerId: dimension.string(),
    country: dimension.string({ label: "Country" }),
    status: dimension.string({ label: "Order Status" }),
    amount: dimension.number({ label: "Amount" }),
    createdAt: dimension.timestamp(),
  },
  measures: {
    revenue: measure.sum('amount', { label: "Revenue" }),
    count: measure.count('id', { label: "Order Count" }),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq'],
    },
  },
  limits: {
    maxDimensions: 5,
  },
});

const TenantOrders = dataset("tenantOrders", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",
  dimensions: {
    id: dimension.string(),
    customerId: dimension.string(),
    country: dimension.string({ label: "Country" }),
    status: dimension.string({ label: "Order Status" }),
    amount: dimension.number({ label: "Amount" }),
    createdAt: dimension.timestamp(),
  },
  measures: {
    revenue: measure.sum('amount', { label: "Revenue" }),
    count: measure.count('id', { label: "Order Count" }),
  },
  filters: {
    status: {
      __type: 'filter_definition',
      field: 'status',
      operators: ['eq'],
    },
  },
  limits: {
    maxDimensions: 5,
  },
});

const OrdersWithAliases = dataset("ordersWithAliases", {
  source: "orders",
  timeKey: "created_at",
  dimensions: {
    createdAt: dimension.timestamp({ column: "created_at" }),
    countryCode: dimension.string({ column: "country_code" }),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const OrdersWithTenantFilter = dataset("ordersWithTenantFilter", {
  source: "orders",
  tenantKey: "tenant_id",
  timeKey: "created_at",
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: "tenant_id" }),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
  filters: {
    tenantId: {
      __type: 'filter_definition',
      field: 'tenantId',
      operators: ['eq'],
    },
  },
});

const totalRevenue = Orders.metric("totalRevenue", {
  measure: "revenue",
  label: "Total Revenue",
  description: "Sum of all order amounts",
});

const orderCount = Orders.metric("orderCount", {
  measure: "count",
  label: "Order Count",
});

const avgOrderValue = Orders.metric("avgOrderValue", {
  uses: { totalRevenue, orderCount },
  formula: ({ totalRevenue, orderCount }) =>
    divide(totalRevenue, nullIfZero(orderCount)),
  label: "Average Order Value",
});

const monthlyRevenue = totalRevenue.by("month");
const aliasedRevenue = OrdersWithAliases.metric("aliasedRevenue", {
  measure: "revenue",
});
const tenantFilteredRevenue = OrdersWithTenantFilter.metric("tenantFilteredRevenue", {
  measure: "revenue",
});
const tenantScopedTotalRevenue = TenantOrders.metric("totalRevenue", {
  measure: "revenue",
  label: "Total Revenue",
  description: "Sum of all order amounts",
});

const BASE_PATH = "/api/analytics";

type SemanticResponseBody = {
  data?: unknown;
  meta?: {
    sql?: string;
    timingMs?: number;
    tenant?: string;
    rowCount?: number;
    pagination?: {
      limit: number;
      offset: number;
      hasMore: boolean;
    };
  };
  error?: {
    type?: string;
    message: string;
    details?: {
      issues?: Array<{
        path?: Array<string | number>;
        message?: string;
      }>;
    };
  };
};

type OpenApiOperation = {
  requestBody: {
    content: Record<string, {
      schema: {
        properties: Record<string, unknown>;
      };
    }>;
  };
};

type OpenApiDocument = {
  paths: Record<string, {
    post?: OpenApiOperation;
  }>;
};

type TestAuth = {
  tenantId?: string;
  userId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSemanticResponseBody(value: unknown): value is SemanticResponseBody {
  return isRecord(value);
}

function semanticBody(response: { body: unknown }): SemanticResponseBody {
  if (!isSemanticResponseBody(response.body)) {
    throw new Error('Expected response body to be an object.');
  }

  return response.body;
}

function isOpenApiDocument(value: unknown): value is OpenApiDocument {
  return isRecord(value) && isRecord(value.paths);
}

function openApiDocument(response: { body: unknown }): OpenApiDocument {
  if (!isOpenApiDocument(response.body)) {
    throw new Error('Expected OpenAPI response body to contain paths.');
  }

  return response.body;
}

function stringValue(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string value, received ${typeof value}.`);
  }

  return value;
}

function requiredTenantId(auth: TestAuth): string {
  if (!auth.tenantId) {
    throw new Error('Expected tenantId in test auth context.');
  }

  return auth.tenantId;
}

function optionalTenantId(auth: TestAuth): string | undefined {
  return auth.tenantId;
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

function createMockBuilderFactory(
  mockDataOverride?: Array<Record<string, unknown>>,
): QueryBuilderFactoryLike & { _calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = {};
  const track = (name: string, ...args: unknown[]) => {
    calls[name] = calls[name] || [];
    calls[name].push(args);
  };

  const mockData = mockDataOverride ?? [
    { country: "US", totalRevenue: 5000 },
    { country: "DE", totalRevenue: 3000 },
  ];

  function createMockBuilder(source: string): QueryBuilderLike {
    const state: {
      source: string;
      select: string[];
      where: string[];
      groupBy: string[];
      orderBy: string[];
      limit?: number;
      offset?: number;
    } = {
      source,
      select: [],
      where: [],
      groupBy: [],
      orderBy: [],
    };

    const buildSql = () => [
      `SELECT ${state.select.join(', ')} FROM ${state.source}`,
      state.where.length > 0 ? `WHERE ${state.where.join(' AND ')}` : '',
      state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.join(', ')}` : '',
      state.orderBy.length > 0 ? `ORDER BY ${state.orderBy.join(', ')}` : '',
      state.limit != null ? `LIMIT ${state.limit}` : '',
      state.offset != null ? `OFFSET ${state.offset}` : '',
    ].filter(Boolean).join(' ');

    const builder: QueryBuilderLike = {
      select: (columns: string[] | string) => {
        track('select', columns);
        state.select.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      sum: (column: string, alias?: string) => {
        track('sum', column, alias);
        state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
        return builder;
      },
      count: (column: string, alias?: string) => {
        track('count', column, alias);
        state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
        return builder;
      },
      countDistinct: (column: string, alias?: string) => {
        track('countDistinct', column, alias);
        state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
        return builder;
      },
      avg: (column: string, alias?: string) => {
        track('avg', column, alias);
        state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
        return builder;
      },
      min: (column: string, alias?: string) => {
        track('min', column, alias);
        state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
        return builder;
      },
      max: (column: string, alias?: string) => {
        track('max', column, alias);
        state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
        return builder;
      },
      where: (column: string, operator: string, value: unknown) => {
        track('where', column, operator, value);
        const sqlOperator = operator === 'eq' ? '=' : operator;
        state.where.push(`${column} ${sqlOperator} ?`);
        return builder;
      },
      groupBy: (columns: string | string[]) => {
        track('groupBy', columns);
        state.groupBy.push(...(Array.isArray(columns) ? columns : [columns]));
        return builder;
      },
      orderBy: (column: string, direction?: 'ASC' | 'DESC') => {
        track('orderBy', column, direction);
        state.orderBy.push(`${column} ${direction ?? 'ASC'}`);
        return builder;
      },
      limit: (count: number) => {
        track('limit', count);
        state.limit = count;
        return builder;
      },
      offset: (count: number) => {
        track('offset', count);
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
    _calls: calls,
    table: (name: string) => {
      track('table', name);
      return createMockBuilder(name);
    },
    rawQuery: vi.fn((sql: string, params?: unknown[]) => {
      track('rawQuery', sql, params);
      return Promise.resolve(mockData);
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================================
// TESTS
// =============================================================================

describe("Serve integration — metrics", () => {
  describe("createAPI with metrics", () => {
    it("throws if queryBuilder is missing when metrics are provided", () => {
      expect(() =>
        createAPI({
          metrics: { totalRevenue },
        })
      ).toThrow("queryBuilder");
    });

    it("creates API with metric endpoints", () => {
      const api = createAPI({
        metrics: { totalRevenue, orderCount },
        queryBuilder: createMockBuilderFactory(),
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
        queryBuilder: createMockBuilderFactory(),
      });

      expect(api).toBeDefined();
    });

    it("throws when a metric name collides with an existing query key", () => {
      expect(() =>
        createAPI({
          queries: {
            totalRevenue: { query: async () => ({ ok: true }) },
          },
          metrics: { totalRevenue },
          queryBuilder: createMockBuilderFactory(),
        })
      ).toThrow('metric "totalRevenue" collides with an existing query key');
    });
  });

  describe("manifest()", () => {
    it("maps queries, metrics, and datasets to full method + path", () => {
      const api = createAPI({
        queries: {
          ping: { query: async () => ({ ok: true }) },
        },
        metrics: { totalRevenue },
        datasets: { orders: Orders },
        queryBuilder: createMockBuilderFactory(),
      });

      const manifest = api.manifest();

      // Plain queries default to GET under /queries.
      expect(manifest.ping).toEqual({
        method: "GET",
        path: "/api/analytics/queries/ping",
      });
      // Metrics are POST under /metrics/<name>.
      expect(manifest.totalRevenue).toEqual({
        method: "POST",
        path: "/api/analytics/metrics/totalRevenue",
      });
      // Datasets are keyed `dataset:<name>` and POST under /datasets/<name>/query.
      expect(manifest["dataset:orders"]).toEqual({
        method: "POST",
        path: "/api/analytics/datasets/orders/query",
      });
    });

    it("respects a custom basePath", () => {
      const api = createAPI({
        basePath: "/v1/analytics",
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      expect(api.manifest().totalRevenue).toEqual({
        method: "POST",
        path: "/v1/analytics/metrics/totalRevenue",
      });
    });

    it("excludes internal openapi and docs routes", () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const keys = Object.keys(api.manifest());
      expect(keys).toEqual(["totalRevenue"]);
    });
  });

  describe("metric endpoints", () => {
    it("responds to POST /metrics/:name", async () => {
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
      expect(response.body).toHaveProperty("data");
      expect(semanticBody(response).data).toEqual([
        { country: "US", totalRevenue: 5000 },
        { country: "DE", totalRevenue: 3000 },
      ]);
    });

    it("returns 404 for unknown metric", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
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
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["nonexistent_field"] },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.type).toBe("VALIDATION_ERROR");
      expect(semanticBody(response).error.message).toBe("Request validation failed");
      expect(semanticBody(response).error.details?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["dimensions", 0] }),
        ]),
      );
    });

    it("returns 400 for disallowed metric filter operators", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {
            filters: [{ field: "status", operator: "like", value: "%complete%" }],
          },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.message).toContain('does not allow operator "like"');
    });

    it("clamps metric limit to maxLimit instead of rejecting", async () => {
      const api = createAPI({
        metrics: { revenue: { metric: totalRevenue, maxLimit: 50 } },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/revenue",
          method: "POST",
          body: { dimensions: ["country"], limit: 5000 },
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).meta.pagination?.limit).toBe(50);
    });

    it("applies a default limit to unbounded metric queries", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"] },
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      // No limit sent → defaults to 1000 (parity with dataset endpoints).
      expect(semanticBody(response).meta.pagination?.limit).toBe(1000);
    });

    it("passes dimensions and filters to the semantic client", async () => {
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
            orderBy: [{ field: "totalRevenue", direction: "desc" }],
            limit: 10,
          },
        })
      );

      expect(factory._calls['select']).toBeDefined();
      expect(factory._calls['select'][0][0]).toContain('country');
      expect(factory._calls['sum']).toContainEqual(['amount', 'totalRevenue']);
      expect(factory._calls['where']).toContainEqual(['status', 'eq', 'completed']);
      expect(factory._calls['limit']).toContainEqual([10]);
    });

    it("supports time graining via body.by", async () => {
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

      expect(factory._calls['select']).toBeDefined();
      expect(factory._calls['select'][0][0]).toContain('toStartOfMonth(created_at) AS period');
    });

    it("supports grained metric refs in createAPI", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { monthlyRevenue },
        queryBuilder: factory,
      });

      await api.handler(
        createRequest({
          path: "/metrics/monthlyRevenue",
          method: "POST",
          body: {},
        })
      );

      expect(factory._calls['select']).toBeDefined();
      expect(factory._calls['select'][0][0]).toContain('toStartOfMonth(created_at) AS period');
      expect(factory._calls['orderBy']).toContainEqual(['period', 'ASC']);
    });

    it("rejects conflicting body.by for grained metric refs", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { monthlyRevenue },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/monthlyRevenue",
          method: "POST",
          body: { by: "week" },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.message).toContain('already grained by "month"');
    });

    it("works with derived metrics", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { avgOrderValue },
        queryBuilder: factory,
      });

      await api.handler(
        createRequest({
          path: "/metrics/avgOrderValue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      const sql = stringValue(factory._calls['rawQuery'][0][0]);
      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("NULLIF(orderCount, 0)");
    });

    it("matches the docs-style monthly metric example end-to-end", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { monthlyRevenue },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/monthlyRevenue",
          method: "POST",
          body: {
            dimensions: ["country"],
            orderBy: [{ field: "period", direction: "asc" }],
            limit: 12,
          },
        })
      );

      expect(response.status).toBe(200);
      expect(factory._calls['select']).toBeDefined();
      expect(factory._calls['select'][0][0]).toContain('toStartOfMonth(created_at) AS period');
      expect(factory._calls['select'][0][0]).toContain('country');
      expect(factory._calls['orderBy']).toContainEqual(['period', 'ASC']);
      expect(factory._calls['limit']).toContainEqual([12]);
    });

    it("resolves aliased dimensions and filters through dataset field mappings", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { aliasedRevenue },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/aliasedRevenue",
          method: "POST",
          body: {
            dimensions: ["countryCode"],
            filters: [{ field: "createdAt", operator: "gte", value: "2025-01-01" }],
            by: "month",
          },
        })
      );

      expect(response.status).toBe(200);
      expect(factory._calls['select']).toBeDefined();
      const selectArgs = factory._calls['select'].flat(2);
      expect(selectArgs).toContain('toStartOfMonth(created_at) AS period');
      expect(selectArgs).toContain('country_code AS countryCode');
      expect(factory._calls['where']).toContainEqual(['created_at', 'gte', '2025-01-01']);
    });
  });

  describe("meta / envelope", () => {
    it("excludes meta by default", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
        })
      );

      expect(semanticBody(response).meta).toBeUndefined();
    });

    it("includes meta when X-Include-Meta header is set", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
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

      expect(semanticBody(response).meta).toBeDefined();
      expect(semanticBody(response).meta.sql).toBeDefined();
    });

    it("includes meta via the includeMeta input field and reports rowCount", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: { dimensions: ["country"], includeMeta: true },
        })
      );

      expect(semanticBody(response).meta).toBeDefined();
      expect(semanticBody(response).meta.sql).toBeDefined();
      // Mock returns 2 rows.
      expect(semanticBody(response).meta.rowCount).toBe(2);
    });

    it("matches MetricQueryEngine.toSQL() for base metrics", async () => {
      const factory = createMockBuilderFactory();
      const engine = new MetricQueryEngine({ builderFactory: factory });
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });
      const query = {
        dimensions: ["country"],
        filters: [{ field: "status", operator: "eq", value: "completed" }] as const,
        orderBy: [{ field: "totalRevenue", direction: "desc" }] as const,
        limit: 10,
      };

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: query,
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      // run() over-fetches one row (LIMIT + 1) to derive pagination.hasMore.
      expect(semanticBody(response).meta.sql).toBe(
        engine.toSQL(totalRevenue, { ...query, limit: query.limit + 1 }),
      );
    });

    it("matches MetricQueryEngine.toSQL() for derived metrics", async () => {
      const factory = createMockBuilderFactory();
      const engine = new MetricQueryEngine({ builderFactory: factory });
      const api = createAPI({
        metrics: { avgOrderValue },
        queryBuilder: factory,
      });
      const query = {
        dimensions: ["country"],
      };

      const response = await api.handler(
        createRequest({
          path: "/metrics/avgOrderValue",
          method: "POST",
          body: query,
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      // No limit was sent, so the endpoint applies the default cap (1000) and
      // over-fetches one row (1001) to derive pagination.hasMore.
      expect(semanticBody(response).meta.sql).toBe(
        engine.toSQL(avgOrderValue, { ...query, limit: 1001 }),
      );
    });
  });

  describe("tenant injection", () => {
    it("injects tenant ID into metric queries when tenant config is provided", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue: tenantScopedTotalRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
          column: 'tenant_id',
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
      expect(factory._calls['where']).toContainEqual(['tenant_id', 'eq', 'tenant-123']);
    });

    it("falls back to the dataset tenantKey when tenant isolation is enabled without tenant.column", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue: tenantScopedTotalRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
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
      expect(factory._calls['where']).toContainEqual(['tenant_id', 'eq', 'tenant-123']);
    });

    it("rejects explicit tenant filters on metric endpoints when runtime tenancy is active", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { tenantFilteredRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
        },
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/tenantFilteredRevenue",
          method: "POST",
          body: {
            filters: [{ field: "tenantId", operator: "eq", value: "tenant-123" }],
          },
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.message).toContain('Cannot filter on tenant field "tenantId"');
    });

    it("uses the dataset tenantKey for semantic metrics even when Serve auto-inject has a different column", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue: tenantScopedTotalRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
          column: 'organization_id',
          mode: 'auto-inject',
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
      expect(factory._calls['where']).toContainEqual(['tenant_id', 'eq', 'tenant-123']);
      expect(factory._calls['where']).not.toContainEqual(['organization_id', 'eq', 'tenant-123']);
    });

    it("does not warn about manual tenant mode for generated metric endpoints", async () => {
      const factory = createMockBuilderFactory();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
      const api = createAPI({
        metrics: { totalRevenue: tenantScopedTotalRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
          column: 'tenant_id',
        },
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {},
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(200);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("per-metric overrides", () => {
    it("accepts shorthand metric entry", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
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
        queryBuilder: createMockBuilderFactory(),
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
        queryBuilder: createMockBuilderFactory(),
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

    it("applies per-metric tenant overrides", async () => {
      const api = createAPI({
        metrics: {
          totalRevenue: {
            metric: totalRevenue,
            tenant: { required: false },
          },
        },
        queryBuilder: createMockBuilderFactory(),
        auth: async () => ({ userId: "user-123" }),
        tenant: {
          extract: optionalTenantId,
          required: true,
        },
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

  describe("OpenAPI", () => {
    it("includes metric endpoints in OpenAPI spec", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/openapi.json",
          method: "GET",
        })
      );

      expect(response.status).toBe(200);
      const doc = openApiDocument(response);
      const metricPath = Object.keys(doc.paths).find(p => p.includes("totalRevenue"));
      expect(metricPath).toBeDefined();
      expect(doc.paths[metricPath!].post).toBeDefined();
    });

    it("documents metric request body fields in OpenAPI", async () => {
      const api = createAPI({
        metrics: { totalRevenue, monthlyRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/openapi.json",
          method: "GET",
        })
      );

      expect(response.status).toBe(200);
      const doc = openApiDocument(response);
      const baseSchema = doc.paths["/api/analytics/metrics/totalRevenue"].post.requestBody.content["application/json"].schema;
      const grainedSchema = doc.paths["/api/analytics/metrics/monthlyRevenue"].post.requestBody.content["application/json"].schema;

      expect(baseSchema.properties).toHaveProperty("dimensions");
      expect(baseSchema.properties).toHaveProperty("filters");
      expect(baseSchema.properties).toHaveProperty("orderBy");
      expect(baseSchema.properties).toHaveProperty("limit");
      expect(baseSchema.properties).toHaveProperty("offset");
      expect(baseSchema.properties).toHaveProperty("by");
      expect(grainedSchema.properties).toHaveProperty("by");
    });

    it("enumerates metric dimension and filter fields from the dataset contract", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({ path: "/openapi.json", method: "GET" }),
      );

      const doc = openApiDocument(response);
      const schema = doc.paths["/api/analytics/metrics/totalRevenue"]
        .post!.requestBody.content["application/json"].schema as any;

      // dimensions: array of enum over every dataset dimension.
      expect(schema.properties.dimensions.items.enum).toEqual(
        expect.arrayContaining(["country", "status", "amount"]),
      );
      // filters reference the dataset's declared filter keys (Orders → status).
      expect(schema.properties.filters.items.properties.field.enum).toEqual(["status"]);
    });

    it("enumerates dataset dimension, measure, and filter fields", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({ path: "/openapi.json", method: "GET" }),
      );

      const doc = openApiDocument(response);
      const schema = doc.paths["/api/analytics/datasets/orders/query"]
        .post!.requestBody.content["application/json"].schema as any;

      expect(schema.properties.dimensions.items.enum).toEqual(
        expect.arrayContaining(["country", "status"]),
      );
      expect(schema.properties.measures.items.enum).toEqual(
        expect.arrayContaining(["revenue", "count"]),
      );
      expect(schema.properties.filters.items.properties.field.enum).toEqual(["status"]);
    });
  });

  describe("describe()", () => {
    it("includes metric endpoints in describe output", () => {
      const api = createAPI({
        metrics: { totalRevenue, orderCount },
        queryBuilder: createMockBuilderFactory(),
      });

      const description = api.describe();
      const metricEndpoints = description.queries.filter(q => q.tags.includes("metrics"));
      expect(metricEndpoints.length).toBe(2);
    });
  });

  describe("queryLogger", () => {
    it("emits events for metric endpoint execution", async () => {
      const events: ServeQueryEvent[] = [];
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
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
      expect(semanticBody(response).data).toEqual([
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

    it("rejects disallowed metric filter operators before builder execution", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/totalRevenue",
          method: "POST",
          body: {
            filters: [{ field: "status", operator: "like", value: "%complete%" }],
          },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.message).toContain('does not allow operator "like"');
      expect(factory._calls['where']).toBeUndefined();
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
        metrics: { totalRevenue: tenantScopedTotalRevenue },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
          column: 'tenant_id',
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
      const sql = stringValue(factory._calls['rawQuery'][0][0]);
      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("NULLIF(orderCount, 0)");
    });

    it("handles grained derived metrics via builder + rawQuery", async () => {
      const factory = createMockBuilderFactory();
      const api = createAPI({
        metrics: { monthlyAverageOrderValue: avgOrderValue.by("month") },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/monthlyAverageOrderValue",
          method: "POST",
          body: { dimensions: ["country"] },
        })
      );

      expect(response.status).toBe(200);
      expect(factory.rawQuery).toHaveBeenCalled();
      const sql = stringValue(factory._calls['rawQuery'][0][0]);
      expect(sql).toContain("WITH base AS");
      expect(sql).toContain("period");
      expect(sql).toContain("NULLIF(orderCount, 0)");
    });

    it("executes dataset queries via builder.execute() and returns dataset rows", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000, count: 12 },
        { country: "DE", revenue: 3000, count: 8 },
      ]);
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue", "count"],
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).data).toEqual([
        { country: "US", revenue: 5000, count: 12 },
        { country: "DE", revenue: 3000, count: 8 },
      ]);
      expect(factory._calls['table'][0]).toEqual(['orders']);
      expect(factory._calls['select'][0][0]).toContain('country');
      expect(factory._calls['sum']).toContainEqual(['amount', 'revenue']);
      expect(factory._calls['count']).toContainEqual(['id', 'count']);
      expect(factory._calls['groupBy'][0][0]).toContain('country');
    });

    it("returns request validation errors for invalid dataset fields", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["nonexistent_field"],
            measures: ["revenue"],
          },
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.type).toBe("VALIDATION_ERROR");
      expect(semanticBody(response).error.message).toBe("Request validation failed");
      expect(semanticBody(response).error.details?.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ["dimensions", 0] }),
        ]),
      );
    });

    it("executes dataset queries with aliases and time grain and preserves returned row shape", async () => {
      const factory = createMockBuilderFactory([
        { period: "2025-01-01", countryCode: "US", revenue: 5000 },
        { period: "2025-01-01", countryCode: "DE", revenue: 3000 },
      ]);
      const api = createAPI({
        datasets: { ordersWithAliases: OrdersWithAliases },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/ordersWithAliases/query",
          method: "POST",
          body: {
            dimensions: ["countryCode"],
            measures: ["revenue"],
            by: "month",
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).data).toEqual([
        { period: "2025-01-01", countryCode: "US", revenue: 5000 },
        { period: "2025-01-01", countryCode: "DE", revenue: 3000 },
      ]);
      const selectArgs = factory._calls['select'][0][0];
      expect(selectArgs).toContain('toStartOfMonth(created_at) AS period');
      expect(selectArgs).toContain('country_code AS countryCode');
      expect(factory._calls['sum']).toContainEqual(['amount', 'revenue']);
      expect(factory._calls['groupBy'][0][0]).toContain('period');
      expect(factory._calls['groupBy'][0][0]).toContain('countryCode');
    });

    it("passes dataset filters through resolved fields before execution", async () => {
      const factory = createMockBuilderFactory([
        { countryCode: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { ordersWithAliases: OrdersWithAliases },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/ordersWithAliases/query",
          method: "POST",
          body: {
            dimensions: ["countryCode"],
            measures: ["revenue"],
            filters: [{ field: "createdAt", operator: "gte", value: "2025-01-01" }],
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).data).toEqual([
        { countryCode: "US", revenue: 5000 },
      ]);
      expect(factory._calls['where']).toContainEqual(['created_at', 'gte', '2025-01-01']);
    });

    it("applies dataset order/limit/offset via builder methods", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
            orderBy: [{ field: "revenue", direction: "desc" }],
            limit: 25,
            offset: 10,
          },
        })
      );

      expect(response.status).toBe(200);
      expect(factory._calls['orderBy']).toContainEqual(['revenue', 'DESC']);
      // Over-fetches one extra row (LIMIT 25 + 1) to derive pagination.hasMore.
      expect(factory._calls['limit']).toContainEqual([26]);
      expect(factory._calls['offset']).toContainEqual([10]);
    });

    it("caps dataset limit to the endpoint max limit", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: {
          orders: {
            dataset: Orders,
            maxLimit: 50,
          },
        },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
            limit: 500,
          },
        })
      );

      expect(response.status).toBe(200);
      // Limit is capped to maxLimit (50); the executor over-fetches one extra
      // row (51) for pagination, while returned data stays within the cap.
      expect(factory._calls['limit']).toContainEqual([51]);
    });

    it("includes dataset meta when X-Include-Meta header is set", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
          },
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).meta).toBeDefined();
      expect(semanticBody(response).meta.sql).toBeDefined();
      expect(semanticBody(response).meta.rowCount).toBe(1);
    });

    it("includes meta via the includeMeta input field (no header)", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
            includeMeta: true,
          },
        })
      );

      expect(response.status).toBe(200);
      expect(semanticBody(response).meta).toBeDefined();
      expect(semanticBody(response).meta.sql).toBeDefined();
      expect(semanticBody(response).meta.rowCount).toBe(1);
    });

    it("returns pagination meta with hasMore when a limit is set", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
        { country: "DE", revenue: 3000 },
      ]);
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: factory,
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
            limit: 1,
          },
          headers: {
            'content-type': 'application/json',
            'x-include-meta': 'true',
          },
        })
      );

      expect(response.status).toBe(200);
      // Mock returns 2 rows for an over-fetched LIMIT 2 → trimmed to 1 + hasMore.
      expect(semanticBody(response).data).toHaveLength(1);
      expect(semanticBody(response).meta.pagination).toEqual({
        limit: 1,
        offset: 0,
        hasMore: true,
      });
    });

    it("runs per-endpoint middleware on a dataset endpoint", async () => {
      const calls: string[] = [];
      const api = createAPI({
        datasets: {
          orders: {
            dataset: Orders,
            middlewares: [
              async (_ctx, next) => {
                calls.push("before");
                const result = await next();
                calls.push("after");
                return result;
              },
            ],
          },
        },
        queryBuilder: createMockBuilderFactory([{ country: "US", revenue: 5000 }]),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: { dimensions: ["country"], measures: ["revenue"] },
        })
      );

      expect(response.status).toBe(200);
      expect(calls).toEqual(["before", "after"]);
    });

    it("injects tenant filter into dataset queries when tenant config is provided", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { orders: TenantOrders },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
          column: 'tenant_id',
        },
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
          },
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(200);
      expect(factory._calls['where']).toContainEqual(['tenant_id', 'eq', 'tenant-123']);
    });

    it("falls back to the dataset tenantKey for dataset tenant isolation without tenant.column", async () => {
      const factory = createMockBuilderFactory([
        { country: "US", revenue: 5000 },
      ]);
      const api = createAPI({
        datasets: { orders: TenantOrders },
        queryBuilder: factory,
        auth: async ({ request }) => {
          const key = request.headers['x-api-key'];
          if (key === 'valid') return { tenantId: 'tenant-123' };
          return null;
        },
        tenant: {
          extract: requiredTenantId,
          required: true,
        },
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          method: "POST",
          body: {
            dimensions: ["country"],
            measures: ["revenue"],
          },
          headers: {
            'content-type': 'application/json',
            'x-api-key': 'valid',
          },
        })
      );

      expect(response.status).toBe(200);
      expect(factory._calls['where']).toContainEqual(['tenant_id', 'eq', 'tenant-123']);
    });

    it("rejects empty dataset queries instead of falling back to raw table selection", async () => {
      const EmptyDataset = dataset("emptyDataset", {
        source: "orders",
        dimensions: {},
        measures: {},
      });
      const api = createAPI({
        datasets: { emptyDataset: EmptyDataset },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/emptyDataset/query",
          method: "POST",
          body: {},
        })
      );

      expect(response.status).toBe(400);
      expect(semanticBody(response).error.message).toContain("at least one dimension or measure");
    });

    it("throws when a dataset route key collides with an existing query key", () => {
      expect(() =>
        createAPI({
          queries: {
            "dataset:orders": { query: async () => ({ ok: true }) },
          },
          datasets: { orders: Orders },
          queryBuilder: createMockBuilderFactory(),
        })
      ).toThrow('dataset "dataset:orders" collides with an existing query key');
    });

  });

  describe("semantic contract endpoint", () => {
    it("serves a stable, hashed contract for registered datasets", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({ path: "/contract", method: "GET" })
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        version: number;
        contentHash: string;
        datasets: Record<string, { source: string; dimensions: Record<string, unknown> }>;
      };
      expect(body.version).toBe(1);
      expect(body.contentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(body.datasets.orders.source).toBe("orders");
      expect(Object.keys(body.datasets.orders.dimensions)).toContain("country");
    });

    it("includes named metrics grouped onto their dataset", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({ path: "/contract", method: "GET" })
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        datasets: Record<string, { metrics: Record<string, unknown> }>;
      };
      expect(Object.keys(body.datasets.orders.metrics)).toContain("totalRevenue");
    });

    it("is not registered when no datasets are configured", async () => {
      const api = createAPI({
        metrics: { totalRevenue },
        queryBuilder: createMockBuilderFactory(),
      });

      const response = await api.handler(
        createRequest({ path: "/contract", method: "GET" })
      );

      expect(response.status).toBe(404);
    });
  });
});
