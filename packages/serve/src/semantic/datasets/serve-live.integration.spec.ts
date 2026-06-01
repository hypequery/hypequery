import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAPI } from "../../server/create-api.js";
import {
  dataset,
  dimension,
  divide,
  measure,
  nullIfZero,
} from "@hypequery/datasets";
import type { ServeRequest } from "../../types.js";
import {
  initializeTestConnection,
} from "../../../../clickhouse/src/core/tests/integration/setup.js";
import {
  SETUP_TIMEOUT,
  SKIP_INTEGRATION_TESTS,
} from "../../../../clickhouse/src/core/tests/integration/test-config.js";
import { createDatasetClient } from "../../../../clickhouse/src/datasets.js";
import {
  CLICKHOUSE_CONTAINER_NAME,
  TEST_DATA,
  TEST_CONNECTION_CONFIG,
  isContainerRunning,
  seedClickHouseDatabase,
  startClickHouseContainer,
  stopClickHouseContainer,
  waitForClickHouse,
} from "../../../../../testing/clickhouse/harness.mjs";

const Orders = dataset("orders", {
  source: "orders",
  timeKey: "created_at",
  dimensions: {
    id: dimension.number(),
    userId: dimension.number({ column: "user_id" }),
    status: dimension.string(),
    total: dimension.number({ column: "total" }),
    createdAt: dimension.timestamp({ column: "created_at" }),
  },
  measures: {
    revenue: measure.sum("total"),
    orderCount: measure.count("id"),
    uniqueUsers: measure.countDistinct("userId"),
  },
});

const totalRevenue = Orders.metric("totalRevenue", {
  measure: "revenue",
});

const orderCount = Orders.metric("orderCount", {
  measure: "orderCount",
});

const uniqueUsers = Orders.metric("uniqueUsers", {
  measure: "uniqueUsers",
});

const avgOrderValue = Orders.metric("avgOrderValue", {
  uses: { totalRevenue, orderCount },
  formula: ({ totalRevenue, orderCount }) =>
    divide(totalRevenue, nullIfZero(orderCount)),
});

const monthlyRevenue = totalRevenue.by("month");

const BASE_PATH = "/api/analytics";

type SemanticResponseBody = {
  data: Record<string, unknown>[];
  meta?: {
    sql?: string;
    timingMs?: number;
  };
};

function isSemanticResponseBody(value: unknown): value is SemanticResponseBody {
  return (
    typeof value === "object"
    && value !== null
    && Array.isArray(Reflect.get(value, "data"))
  );
}

function semanticBody(response: { body: unknown }): SemanticResponseBody {
  if (!isSemanticResponseBody(response.body)) {
    throw new Error("Expected semantic response body with data rows.");
  }

  return response.body;
}

function createRequest(overrides: Partial<ServeRequest> = {}): ServeRequest {
  const path = overrides.path ?? "/";
  const normalized = path.startsWith(BASE_PATH)
    ? path
    : `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;

  return {
    method: overrides.method ?? "POST",
    headers: overrides.headers ?? { "content-type": "application/json" },
    query: overrides.query ?? {},
    ...overrides,
    path: normalized,
  };
}

function toNumber(value: unknown): number {
  return Number(value);
}

function toDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToDatabase(
  maxAttempts = 10,
  retryDelayMs = 1_500,
): Promise<Awaited<ReturnType<typeof initializeTestConnection>>> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await initializeTestConnection();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) {
        break;
      }
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}

async function clickHouseIsReachable(): Promise<boolean> {
  try {
    await waitForClickHouse({
      config: TEST_CONNECTION_CONFIG,
      maxAttempts: 3,
      retryDelayMs: 500,
    });
    return true;
  } catch {
    return false;
  }
}

function createLiveDatasetClient() {
  return createDatasetClient({
    host: TEST_CONNECTION_CONFIG.host,
    username: TEST_CONNECTION_CONFIG.user,
    password: TEST_CONNECTION_CONFIG.password,
    database: TEST_CONNECTION_CONFIG.database,
  });
}

describe("Serve live integration — datasets", () => {
  (SKIP_INTEGRATION_TESTS ? describe.skip : describe)("ClickHouse-backed dataset endpoints", () => {
    let startedContainer = false;

    beforeAll(async () => {
      if (!await clickHouseIsReachable()) {
        const containerRunning = await isContainerRunning(CLICKHOUSE_CONTAINER_NAME);
        if (!containerRunning) {
          await startClickHouseContainer();
          startedContainer = true;
        }

        await waitForClickHouse({ config: TEST_CONNECTION_CONFIG });
      }

      await seedClickHouseDatabase({
        config: TEST_CONNECTION_CONFIG,
        data: TEST_DATA,
      });
      await connectToDatabase();
    }, SETUP_TIMEOUT * 2);

    afterAll(async () => {
      if (startedContainer) {
        await stopClickHouseContainer();
      }
    }, SETUP_TIMEOUT);

    it("executes grouped dataset queries with dimensions and multiple measures", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          body: {
            dimensions: ["status"],
            measures: ["revenue", "orderCount", "uniqueUsers"],
            orderBy: [{ field: "status", direction: "asc" }],
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        status: String(row.status),
        revenue: toNumber(row.revenue),
        orderCount: toNumber(row.orderCount),
        uniqueUsers: toNumber(row.uniqueUsers),
      }));

      expect(rows).toEqual([
        { status: "cancelled", revenue: 16.5, orderCount: 1, uniqueUsers: 1 },
        { status: "completed", revenue: 66, orderCount: 3, uniqueUsers: 2 },
        { status: "pending", revenue: 62.25, orderCount: 1, uniqueUsers: 1 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "status",
        "revenue",
        "orderCount",
        "uniqueUsers",
      ]);
    });

    it("applies filters, ordering, and limit against live data", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          body: {
            dimensions: ["userId"],
            measures: ["revenue", "orderCount", "uniqueUsers"],
            filters: [{ field: "status", operator: "eq", value: "completed" }],
            orderBy: [{ field: "revenue", direction: "desc" }],
            limit: 1,
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        userId: toNumber(row.userId),
        revenue: toNumber(row.revenue),
        orderCount: toNumber(row.orderCount),
        uniqueUsers: toNumber(row.uniqueUsers),
      }));

      expect(rows).toEqual([
        { userId: 1, revenue: 36, orderCount: 2, uniqueUsers: 1 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "userId",
        "revenue",
        "orderCount",
        "uniqueUsers",
      ]);
    });

    it("returns grained dataset rows and execution meta from the live builder", async () => {
      const api = createAPI({
        datasets: { orders: Orders },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/datasets/orders/query",
          headers: {
            "content-type": "application/json",
            "x-include-meta": "true",
          },
          body: {
            measures: ["revenue", "orderCount", "uniqueUsers"],
            by: "month",
            orderBy: [{ field: "period", direction: "asc" }],
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        period: toDateString(row.period),
        revenue: toNumber(row.revenue),
        orderCount: toNumber(row.orderCount),
        uniqueUsers: toNumber(row.uniqueUsers),
      }));

      expect(rows).toEqual([
        { period: "2023-01-01", revenue: 144.75, orderCount: TEST_DATA.orders.length, uniqueUsers: 3 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "period",
        "revenue",
        "orderCount",
        "uniqueUsers",
      ]);
      expect(body.meta).toMatchObject({
        sql: expect.stringContaining("COUNT(DISTINCT"),
      });
      expect(typeof body.meta?.timingMs).toBe("number");
    });

    it("executes base metric endpoints with real countDistinct aggregation", async () => {
      const api = createAPI({
        metrics: { uniqueUsers },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/uniqueUsers",
          body: {
            dimensions: ["status"],
            orderBy: [{ field: "status", direction: "asc" }],
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        status: String(row.status),
        uniqueUsers: toNumber(row.uniqueUsers),
      }));

      expect(rows).toEqual([
        { status: "cancelled", uniqueUsers: 1 },
        { status: "completed", uniqueUsers: 2 },
        { status: "pending", uniqueUsers: 1 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "status",
        "uniqueUsers",
      ]);
    });

    it("executes derived metric endpoints against live ClickHouse data", async () => {
      const api = createAPI({
        metrics: { avgOrderValue },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/avgOrderValue",
          body: {
            dimensions: ["status"],
            orderBy: [{ field: "status", direction: "asc" }],
          },
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        status: String(row.status),
        avgOrderValue: toNumber(row.avgOrderValue),
      }));

      expect(rows).toEqual([
        { status: "cancelled", avgOrderValue: 16.5 },
        { status: "completed", avgOrderValue: 22 },
        { status: "pending", avgOrderValue: 62.25 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "status",
        "avgOrderValue",
      ]);
    });

    it("executes grained metric endpoints and returns live SQL meta", async () => {
      const api = createAPI({
        metrics: { monthlyRevenue },
        semanticExecutor: createLiveDatasetClient(),
      });

      const response = await api.handler(
        createRequest({
          path: "/metrics/monthlyRevenue",
          headers: {
            "content-type": "application/json",
            "x-include-meta": "true",
          },
          body: {},
        }),
      );

      expect(response.status).toBe(200);
      const body = semanticBody(response);
      const rows = body.data.map((row) => ({
        period: toDateString(row.period),
        totalRevenue: toNumber(row.totalRevenue),
      }));

      expect(rows).toEqual([
        { period: "2023-01-01", totalRevenue: 144.75 },
      ]);
      expect(Object.keys(body.data[0])).toEqual([
        "period",
        "totalRevenue",
      ]);
      expect(body.meta).toMatchObject({
        sql: expect.stringContaining("toStartOfMonth"),
      });
      expect(typeof body.meta?.timingMs).toBe("number");
    });
  });
});
