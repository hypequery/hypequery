import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineServe } from "./server";
import type { ServeRequest } from "./types";

const createRequest = (overrides: Partial<ServeRequest> = {}): ServeRequest => ({
  method: "GET",
  path: "/",
  headers: {},
  query: {},
  ...overrides,
});

describe("defineServe", () => {
  it("routes registered queries and returns handler output", async () => {
    const api = defineServe({
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

  it("enforces auth strategies and populates auth context", async () => {
    const authContexts: Array<Record<string, unknown> | null> = [];
    const api = defineServe({
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
    expect(unauthorized.body).toMatchObject({
      error: {
        type: "UNAUTHORIZED",
      },
    });
    expect(authContexts).toHaveLength(0);

    const authorized = await api.handler(
      createRequest({
        path: "/secure-metric",
        headers: {
          "x-api-key": "valid-key",
        },
      })
    );

    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ ok: true });
    expect(authContexts[0]).toEqual({ apiKey: "valid-key" });
  });

  it("validates input payloads using endpoint schemas", async () => {
    const received: unknown[] = [];
    const api = defineServe({
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
      error: {
        type: "VALIDATION_ERROR",
      },
    });
    expect(received).toHaveLength(0);

    const valid = await api.handler(
      createRequest({ path: "/reports", query: { from: "2024-01-01" } })
    );

    expect(valid.status).toBe(200);
    expect(received[0]).toEqual({ from: "2024-01-01" });
  });

  it("serves an OpenAPI document from the default route", async () => {
    const api = defineServe({
      openapi: {
        info: {
          title: "Metrics API",
        },
      },
      queries: {
        metric: {
          query: async () => ({ total: 123 }),
          inputSchema: z.object({ from: z.string() }),
          outputSchema: z.object({ total: z.number() }),
          description: "Total metric",
          tags: ["metrics"],
        },
      },
    });

    api.route("/metrics/total", api.queries.metric);

    const response = await api.handler(createRequest({ path: "/openapi.json" }));
    expect(response.status).toBe(200);

    const spec = response.body as any;
    expect(spec.info.title).toBe("Metrics API");
    expect(spec.paths["/metrics/total"]).toBeDefined();
    expect(spec.paths["/metrics/total"].get.parameters).toBeDefined();
    expect(spec.paths["/metrics/total"].get.requestBody).toBeUndefined();
  });

  it("keeps the OpenAPI route public even when auth is required", async () => {
    const api = defineServe({
      queries: {
        report: {
          query: async () => ({ ok: true }),
        },
      },
    });

    api.route("/reports", api.queries.report);

    api.useAuth(async () => null);

    const openapiResponse = await api.handler(createRequest({ path: "/openapi.json" }));
    expect(openapiResponse.status).toBe(200);

    const docsResponse = await api.handler(createRequest({ path: "/docs" }));
    expect(docsResponse.status).toBe(200);
  });

  it("serves the docs UI with an embedded OpenAPI reference", async () => {
    const api = defineServe({
      docs: {
        title: "Acme Analytics",
        subtitle: "Internal metrics",
      },
      queries: {
        report: {
          query: async () => ({ ok: true }),
        },
      },
    });

    api.route("/reports", api.queries.report);

    const docsResponse = await api.handler(createRequest({ path: "/docs" }));
    expect(docsResponse.status).toBe(200);
    expect(docsResponse.headers?.["content-type"]).toContain("text/html");
    expect(docsResponse.body).toContain("<redoc");
    expect(docsResponse.body).toContain("/openapi.json");
  });

  it("injects custom context values into queries", async () => {
    const api = defineServe({
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

  it("executes queries directly via api.execute", async () => {
    const api = defineServe({
      context: () => ({ flag: "execute" }),
      queries: {
        metric: {
          inputSchema: z.object({ limit: z.number().default(5) }),
          outputSchema: z.array(z.object({ value: z.number(), ctx: z.string() })),
          query: async ({ input, ctx }) =>
            Array.from({ length: input.limit }).map((_, idx) => ({ value: idx, ctx: ctx.flag })),
        },
      },
    });

    const result = await api.execute("metric", { input: { limit: 2 } });
    expect(result).toEqual([{ value: 0, ctx: "execute" }, { value: 1, ctx: "execute" }]);
  });
});
