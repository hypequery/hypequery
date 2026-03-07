import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAPI } from "./server/create-api";
import { toNodeHandler, toFetchHandler } from "./adapters/standalone";
import type { ServeRequest } from "./types";

const BASE_PATH = "/api/analytics";
const withBasePath = (path = "/") => {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === BASE_PATH || normalized.startsWith(`${BASE_PATH}/`)) {
    return normalized;
  }
  if (normalized === "/") {
    return BASE_PATH;
  }
  return `${BASE_PATH}${normalized}`;
};

const createRequest = (overrides: Partial<ServeRequest> = {}): ServeRequest => ({
  method: "GET",
  headers: {},
  query: {},
  ...overrides,
  path: withBasePath(overrides.path),
});

describe("createAPI", () => {
  it("routes registered queries and returns handler output", async () => {
    const api = createAPI({
      queries: {
        weeklyRevenue: {
          query: async () => ({
            total: 4200,
          }),
        },
      },
    });

    api.route("/metrics/weekly-revenue", api.queries.weeklyRevenue);

    const response = await api.handler(
      createRequest({ path: "/metrics/weekly-revenue" })
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ total: 4200 });
  });

  it("validates input payloads using endpoint schemas", async () => {
    const received: unknown[] = [];
    const api = createAPI({
      queries: {
        report: {
          query: async ({ input }) => {
            received.push(input);
            return { ok: true };
          },
          inputSchema: z.object({
            from: z.string(),
          }),
        },
      },
    });

    api.route("/reports", api.queries.report);

    const invalid = await api.handler(createRequest({ path: "/reports" }));

    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({
      error: { type: "VALIDATION_ERROR" },
    });
    expect(received).toHaveLength(0);

    const valid = await api.handler(
      createRequest({ path: "/reports", query: { from: "2024-01-01" } })
    );

    expect(valid.status).toBe(200);
    expect(received[0]).toEqual({ from: "2024-01-01" });
  });

  it("enforces auth strategies and populates auth context", async () => {
    const authContexts: Array<Record<string, unknown> | null> = [];
    const api = createAPI({
      queries: {
        secureMetric: {
          query: async ({ ctx }) => {
            authContexts.push(ctx.auth);
            return { ok: true };
          },
        },
      },
    });

    api.route("/secure-metric", api.queries.secureMetric);

    api.useAuth(async ({ request }) => {
      const key = request.headers["x-api-key"];
      if (key === "valid-key") {
        return { apiKey: key };
      }
      return null;
    });

    const unauthorized = await api.handler(
      createRequest({ path: "/secure-metric" })
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await api.handler(
      createRequest({
        path: "/secure-metric",
        headers: { "x-api-key": "valid-key" },
      })
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ ok: true });
    expect(authContexts[0]).toEqual({ apiKey: "valid-key" });
  });

  it("executes queries directly via api.execute", async () => {
    const api = createAPI({
      context: () => ({ flag: "execute" }),
      queries: {
        metric: {
          inputSchema: z.object({ limit: z.number().default(5) }),
          query: async ({ input, ctx }) =>
            Array.from({ length: input.limit }).map((_, idx) => ({ value: idx, ctx: ctx.flag })),
        },
      },
    });

    const result = await api.execute("metric", { input: { limit: 2 } });
    expect(result).toEqual([{ value: 0, ctx: "execute" }, { value: 1, ctx: "execute" }]);
  });

  it("exposes api.run and api.client as aliases for api.execute", async () => {
    const api = createAPI({
      queries: {
        hello: {
          inputSchema: z.object({ name: z.string() }),
          query: async ({ input }) => ({ message: `hi ${input.name}` }),
        },
      },
    });

    const viaRun = await api.run("hello", { input: { name: "Ada" } });
    const viaClient = await api.client("hello", { input: { name: "Ada" } });
    const viaExecute = await api.execute("hello", { input: { name: "Ada" } });

    expect(viaRun).toEqual(viaExecute);
    expect(viaClient).toEqual(viaExecute);
  });

  it("injects custom context values into queries", async () => {
    const api = createAPI({
      context: () => ({ flag: "ctx-powered" }),
      queries: {
        info: {
          query: async ({ ctx }) => ({ message: ctx.flag }),
        },
      },
    });

    api.route("/ctx", api.queries.info);

    const response = await api.handler(createRequest({ path: "/ctx" }));
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: "ctx-powered" });
  });

  it("serves OpenAPI and docs endpoints by default", async () => {
    const api = createAPI({
      queries: {
        metric: {
          query: async () => ({ total: 123 }),
          inputSchema: z.object({ from: z.string() }),
          outputSchema: z.object({ total: z.number() }),
          tags: ["metrics"],
        },
      },
    });

    api.route("/metrics/total", api.queries.metric);

    const openapiResponse = await api.handler(createRequest({ path: "/openapi.json" }));
    expect(openapiResponse.status).toBe(200);

    const docsResponse = await api.handler(createRequest({ path: "/docs" }));
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers?.["content-type"]).toContain("text/html");
  });

  it("does not have a start() method (transport-agnostic)", () => {
    const api = createAPI({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
    });

    expect((api as any).start).toBeUndefined();
  });

  it("emits query events to queryLogger subscribers", async () => {
    const events: any[] = [];
    const api = createAPI({
      queries: {
        metric: { query: async () => ({ value: 42 }) },
      },
    });

    api.route("/metric", api.queries.metric);
    api.queryLogger.on((event) => events.push(event));

    await api.handler(createRequest({ path: "/metric" }));

    expect(events).toHaveLength(2);
    expect(events[0].status).toBe("started");
    expect(events[1].status).toBe("completed");
  });

  it("describe() returns registered endpoints", async () => {
    const api = createAPI({
      queries: {
        revenue: {
          query: async () => ({ total: 100 }),
          tags: ["finance"],
        },
      },
    });

    api.route("/revenue", api.queries.revenue);

    const description = api.describe();
    expect(description.basePath).toBe("/api/analytics");

    const revenueEndpoint = description.queries.find((q) => q.key === "revenue");
    expect(revenueEndpoint).toBeDefined();
    expect(revenueEndpoint!.tags).toContain("finance");
  });
});

describe("toNodeHandler", () => {
  it("creates a Node.js HTTP handler from a HypeQueryAPI", async () => {
    const api = createAPI({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
    });

    api.route("/ping", api.queries.ping);

    const handler = toNodeHandler(api);
    expect(typeof handler).toBe("function");

    // The handler is a (req, res) => void function
    // We can verify it's callable; full integration requires a real HTTP server
  });
});

describe("toFetchHandler", () => {
  it("creates a Fetch API handler from a HypeQueryAPI", async () => {
    const api = createAPI({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
    });

    api.route("/ping", api.queries.ping);

    const handler = toFetchHandler(api);
    expect(typeof handler).toBe("function");

    // Test with a real Request object
    const request = new Request("http://localhost/api/analytics/ping", {
      method: "GET",
    });

    const response = await handler(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });
});
