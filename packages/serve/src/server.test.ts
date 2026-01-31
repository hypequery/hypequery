import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineServe } from "./server";
import type { ServeRequest } from "./types";
import type { ServeQueryEvent } from "./query-logger";

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
    const registeredPath = `${BASE_PATH}/metrics/total`;
    expect(spec.paths[registeredPath]).toBeDefined();
    expect(spec.paths[registeredPath].get.parameters).toBeDefined();
    expect(spec.paths[registeredPath].get.requestBody).toBeUndefined();
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

  it('exposes api.run as an alias for api.execute', async () => {
    const api = defineServe({
      queries: {
        hello: {
          inputSchema: z.object({ name: z.string() }),
          query: async ({ input }) => ({ message: `hi ${input.name}` }),
        },
      },
    });

    const viaRun = await api.run('hello', { input: { name: 'Ada' } });
    expect(viaRun).toEqual({ message: 'hi Ada' });

    const viaExecute = await api.execute('hello', { input: { name: 'Ada' } });
    expect(viaExecute).toEqual(viaRun);
  });

  it("invokes lifecycle hooks for HTTP and execute flows", async () => {
    const hooks = {
      onRequestStart: vi.fn(),
      onRequestEnd: vi.fn(),
      onError: vi.fn(),
      onAuthFailure: vi.fn(),
    };
    const api = defineServe({
      hooks,
      queries: {
        metric: {
          inputSchema: z.object({ flag: z.string() }),
          outputSchema: z.object({ value: z.string() }),
          query: async ({ input }) => ({ value: input.flag }),
        },
      },
    });

    api.route("/metric", api.queries.metric);

    await api.handler(createRequest({ path: "/metric", query: { flag: "x" } }));
    expect(hooks.onRequestStart).toHaveBeenCalled();
    expect(hooks.onRequestEnd).toHaveBeenCalled();

    await api.execute("metric", { input: { flag: "embedded" } });
    expect(hooks.onRequestEnd).toHaveBeenCalledTimes(2);

    await expect(api.execute("metric", { input: {} as any })).rejects.toThrow();
    expect(hooks.onError).toHaveBeenCalled();
  });

  it("triggers auth failure hooks when authentication is missing", async () => {
    const hooks = {
      onAuthFailure: vi.fn(),
    };
    const api = defineServe({
      hooks,
      queries: {
        secure: {
          query: async () => ({ ok: true }),
        },
      },
    });

    api.route("/secure", api.queries.secure);
    api.useAuth(async () => null);

    const response = await api.handler(createRequest({ path: "/secure" }));
    expect(response.status).toBe(401);
    expect(hooks.onAuthFailure).toHaveBeenCalled();
  });

  it("enforces multi-tenancy by extracting and validating tenant ID", async () => {
    const tenantIds: Array<string | undefined> = [];

    const api = defineServe({
      queries: {
        orders: {
          query: async ({ ctx }) => {
            tenantIds.push(ctx.tenantId);
            return { orders: [] };
          },
          tenant: {
            extract: (auth) => auth.tenantId,
            required: true,
          },
        },
        optionalTenant: {
          query: async ({ ctx }) => {
            tenantIds.push(ctx.tenantId);
            return { data: "ok" };
          },
          tenant: {
            extract: (auth) => auth.tenantId,
            required: false,
          },
        },
      },
    });

    api.route("/orders", api.queries.orders);
    api.route("/optional", api.queries.optionalTenant);

    // Configure auth to always return a user, with optional tenant
    api.useAuth(async ({ request }) => {
      const tenantId = request.headers["x-tenant-id"];
      return { userId: "user-123", tenantId };
    });

    // Test 1: Missing tenant ID should fail when required
    const missingTenant = await api.handler(
      createRequest({ path: "/orders" })
    );
    expect(missingTenant.status).toBe(403);
    expect(missingTenant.body).toMatchObject({
      error: {
        type: "UNAUTHORIZED",
        message: expect.stringContaining("Tenant context is required"),
        details: {
          reason: "missing_tenant_context",
          tenant_required: true,
        },
      },
    });

    // Test 2: Valid tenant ID should succeed
    const validTenant = await api.handler(
      createRequest({
        path: "/orders",
        headers: { "x-tenant-id": "org-123" },
      })
    );
    expect(validTenant.status).toBe(200);
    expect(tenantIds[0]).toBe("org-123");

    // Test 3: Optional tenant should work without tenant ID
    const optionalWithout = await api.handler(
      createRequest({ path: "/optional" })
    );
    expect(optionalWithout.status).toBe(200);
    expect(tenantIds[1]).toBeUndefined();

    // Test 4: Optional tenant should work with tenant ID
    const optionalWith = await api.handler(
      createRequest({
        path: "/optional",
        headers: { "x-tenant-id": "org-456" },
      })
    );
    expect(optionalWith.status).toBe(200);
    expect(tenantIds[2]).toBe("org-456");
  });

  it("includes custom metadata in endpoint descriptions", async () => {
    const api = defineServe({
      queries: {
        analytics: {
          query: async () => ({ data: [] }),
          custom: {
            owner: "data-team",
            sla: "100ms",
            costEstimate: "low",
          },
        },
      },
    });

    api.route("/analytics", api.queries.analytics);

    const description = api.describe();
    const analyticsEndpoint = description.queries.find((q) => q.key === "analytics");

    expect(analyticsEndpoint?.custom).toEqual({
      owner: "data-team",
      sla: "100ms",
      costEstimate: "low",
    });
  });

  it("auto-injects tenant filters when mode is auto-inject", async () => {
    // Create a mock query builder to verify tenant filtering is applied
    const queryLog: Array<{ table: string; filters: Array<{ column: string; operator: string; value: string }> }> = [];

    const mockDb = {
      table: (name: string) => {
        const filters: Array<{ column: string; operator: string; value: string }> = [];
        const chainable: any = {
          where: (column: string, operator: string, value: string) => {
            filters.push({ column, operator, value });
            return chainable; // Return self for chaining
          },
          select: () => {
            queryLog.push({ table: name, filters });
            return Promise.resolve([{ id: 1, name: "Test" }]);
          },
        };
        return chainable;
      },
    };

    const api = defineServe({
      context: () => ({
        db: mockDb,
      }),
      tenant: {
        extract: (auth) => auth.tenantId,
        required: true,
        column: "organization_id",
        mode: "auto-inject",
      },
      queries: {
        users: {
          query: async ({ ctx }) => {
            // Use the auto-scoped db - it should automatically filter by organization_id
            return ctx.db.table("users").where("status", "=", "active").select();
          },
        },
      },
    });

    api.route("/users", api.queries.users);

    api.useAuth(async ({ request }) => {
      const tenantId = request.headers["x-tenant-id"];
      return { userId: "user-123", tenantId };
    });

    const response = await api.handler(
      createRequest({
        path: "/users",
        headers: { "x-tenant-id": "org-456" },
      })
    );

    expect(response.status).toBe(200);
    // Verify that the tenant filter was automatically injected
    expect(queryLog).toHaveLength(1);
    expect(queryLog[0].table).toBe("users");
    expect(queryLog[0].filters).toContainEqual({
      column: "organization_id",
      operator: "eq",
      value: "org-456",
    });
    expect(queryLog[0].filters).toContainEqual({
      column: "status",
      operator: "=",
      value: "active",
    });
  });

  it("does not auto-inject when mode is manual", async () => {
    const queryLog: Array<{ table: string; filters: Array<{ column: string; value: string }> }> = [];

    const mockDb = {
      table: (name: string) => {
        const filters: Array<{ column: string; value: string }> = [];
        const chainable: any = {
          where: (column: string, operator: string, value: string) => {
            filters.push({ column, value });
            return chainable; // Return self for chaining
          },
          select: () => {
            queryLog.push({ table: name, filters });
            return Promise.resolve([{ id: 1, name: "Test" }]);
          },
        };
        return chainable;
      },
    };

    // Capture console warnings
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const api = defineServe({
      context: () => ({
        db: mockDb,
      }),
      tenant: {
        extract: (auth) => auth.tenantId,
        required: true,
        column: "organization_id",
        mode: "manual", // Manual mode - developer must add WHERE clause
      },
      queries: {
        users: {
          query: async ({ ctx }) => {
            // Developer must manually filter by tenant
            return ctx.db.table("users").where("organization_id", "=", ctx.tenantId).select();
          },
        },
      },
    });

    api.route("/users", api.queries.users);

    api.useAuth(async ({ request }) => {
      const tenantId = request.headers["x-tenant-id"];
      return { userId: "user-123", tenantId };
    });

    const response = await api.handler(
      createRequest({
        path: "/users",
        headers: { "x-tenant-id": "org-789" },
      })
    );

    expect(response.status).toBe(200);
    // Verify no automatic injection - only the manual filter
    expect(queryLog).toHaveLength(1);
    expect(queryLog[0].filters).toEqual([
      { column: "organization_id", value: "org-789" },
    ]);

    // Verify warning was shown
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[hypequery/serve] Query "users" uses manual tenant mode')
    );

    warnSpy.mockRestore();
  });

  it("handles global tenant config with per-query override", async () => {
    const queryLog: Array<{ table: string; tenantFilter: boolean }> = [];

    const mockDb = {
      table: (name: string) => {
        let hasTenantFilter = false;
        const chainable: any = {
          where: (column: string, operator: string, value: string) => {
            if (column === "org_id" && value !== undefined) {
              hasTenantFilter = true;
            }
            return chainable;
          },
          select: () => {
            queryLog.push({
              table: name,
              tenantFilter: hasTenantFilter,
            });
            return Promise.resolve([]);
          },
        };
        return chainable;
      },
    };

    const api = defineServe({
      context: () => ({ db: mockDb }),
      // Global tenant config
      tenant: {
        extract: (auth) => auth.tenantId,
        required: true,
        column: "org_id",
        mode: "auto-inject",
      },
      queries: {
        // Inherits global config
        orders: {
          query: async ({ ctx }) => {
            return ctx.db.table("orders").where("status", "=", "active").select();
          },
        },
        // Overrides with different config
        adminUsers: {
          query: async ({ ctx }) => {
            return ctx.db.table("users").where("role", "=", "admin").select();
          },
          tenant: {
            extract: (auth) => auth.tenantId,
            required: false, // Optional for this endpoint
          },
        },
      },
    });

    api.route("/orders", api.queries.orders);
    api.route("/admin/users", api.queries.adminUsers);

    api.useAuth(async ({ request }) => {
      const tenantId = request.headers["x-tenant-id"];
      return { userId: "user-123", tenantId };
    });

    // Test global config applies
    await api.handler(
      createRequest({
        path: "/orders",
        headers: { "x-tenant-id": "org-999" },
      })
    );

    expect(queryLog[0].table).toBe("orders");
    expect(queryLog[0].tenantFilter).toBe(true);

    // Test override config (optional tenant)
    await api.handler(createRequest({ path: "/admin/users" }));

    expect(queryLog[1].table).toBe("users");
    // No tenant filter since it's optional and no tenant was provided
  });

  it("wraps multiple query builders in context when using auto-inject", async () => {
    const primaryLog: string[] = [];
    const replicaLog: string[] = [];

    const createMockDb = (log: string[]) => ({
      table: (name: string) => {
        const chainable: any = {
          where: (column: string, operator: string, value: string) => {
            log.push(`${name}:${column}=${value}`);
            return chainable;
          },
          select: () => Promise.resolve([]),
        };
        return chainable;
      },
    });

    const api = defineServe({
      context: () => ({
        primaryDb: createMockDb(primaryLog),
        replicaDb: createMockDb(replicaLog),
      }),
      tenant: {
        extract: (auth) => auth.tenantId,
        required: true,
        column: "tenant_id",
        mode: "auto-inject",
      },
      queries: {
        analytics: {
          query: async ({ ctx }) => {
            // Both databases should have tenant filters auto-injected
            await ctx.primaryDb.table("events").where("type", "=", "click").select();
            await ctx.replicaDb.table("users").where("active", "=", "true").select();
            return { success: true };
          },
        },
      },
    });

    api.route("/analytics", api.queries.analytics);

    api.useAuth(async ({ request }) => {
      const tenantId = request.headers["x-tenant-id"];
      return { userId: "user-123", tenantId };
    });

    await api.handler(
      createRequest({
        path: "/analytics",
        headers: { "x-tenant-id": "tenant-abc" },
      })
    );

    // Both query builders should have tenant filters
    expect(primaryLog).toContain("events:tenant_id=tenant-abc");
    expect(replicaLog).toContain("users:tenant_id=tenant-abc");
  });

  it("returns X-Request-Id header on success responses", async () => {
    const api = defineServe({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
    });

    api.route("/ping", api.queries.ping);

    const response = await api.handler(createRequest({ path: "/ping" }));
    expect(response.status).toBe(200);
    expect(response.headers?.["x-request-id"]).toBeDefined();
    expect(typeof response.headers?.["x-request-id"]).toBe("string");
  });

  it("echoes incoming X-Request-Id header in the response", async () => {
    const api = defineServe({
      queries: {
        ping: { query: async () => ({ ok: true }) },
      },
    });

    api.route("/ping", api.queries.ping);

    const response = await api.handler(
      createRequest({
        path: "/ping",
        headers: { "x-request-id": "req-abc-123" },
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers?.["x-request-id"]).toBe("req-abc-123");
  });

  it("returns X-Request-Id header on error responses", async () => {
    const api = defineServe({
      queries: {
        fail: {
          query: async () => { throw new Error("boom"); },
        },
      },
    });

    api.route("/fail", api.queries.fail);

    const response = await api.handler(createRequest({ path: "/fail" }));
    expect(response.status).toBe(500);
    expect(response.headers?.["x-request-id"]).toBeDefined();

    // 404 also gets request id
    const notFound = await api.handler(createRequest({ path: "/nope" }));
    expect(notFound.status).toBe(404);
    expect(notFound.headers?.["x-request-id"]).toBeDefined();
  });

  it("emits query events to queryLogger subscribers", async () => {
    const events: ServeQueryEvent[] = [];
    const api = defineServe({
      queries: {
        metric: { query: async () => ({ value: 42 }) },
      },
    });

    api.route("/metric", api.queries.metric);
    api.queryLogger.on((event) => events.push(event));

    await api.handler(createRequest({ path: "/metric" }));

    expect(events).toHaveLength(2);
    expect(events[0].status).toBe("started");
    expect(events[0].endpointKey).toBe("metric");
    expect(events[1].status).toBe("completed");
    expect(events[1].durationMs).toBeTypeOf("number");
    expect(events[1].responseStatus).toBe(200);
  });

  it("emits error events when a query throws", async () => {
    const events: ServeQueryEvent[] = [];
    const api = defineServe({
      queries: {
        broken: {
          query: async () => { throw new Error("db down"); },
        },
      },
    });

    api.route("/broken", api.queries.broken);
    api.queryLogger.on((event) => events.push(event));

    await api.handler(createRequest({ path: "/broken" }));

    const errorEvent = events.find((e) => e.status === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.responseStatus).toBe(500);
    expect(errorEvent!.error?.message).toBe("db down");
  });

  it("does not emit events when no listeners are subscribed", async () => {
    const api = defineServe({
      queries: {
        metric: { query: async () => ({ value: 1 }) },
      },
    });

    api.route("/metric", api.queries.metric);

    // No listener — just verify it doesn't throw
    const response = await api.handler(createRequest({ path: "/metric" }));
    expect(response.status).toBe(200);
    expect(api.queryLogger.listenerCount).toBe(0);
  });

  it("logs to console when queryLogging is true", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const api = defineServe({
      queryLogging: true,
      queries: {
        metric: { query: async () => ({ value: 1 }) },
      },
    });

    api.route("/metric", api.queries.metric);
    await api.handler(createRequest({ path: "/metric" }));

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("GET")
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("200")
    );

    logSpy.mockRestore();
  });

  it("logs structured JSON when queryLogging is 'json'", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const api = defineServe({
      queryLogging: "json",
      queries: {
        metric: { query: async () => ({ value: 1 }) },
      },
    });

    api.route("/metric", api.queries.metric);
    await api.handler(createRequest({ path: "/metric" }));

    expect(logSpy).toHaveBeenCalled();
    const jsonArg = logSpy.mock.calls.find(([arg]) => {
      try { JSON.parse(arg); return true; } catch { return false; }
    });
    expect(jsonArg).toBeDefined();

    const parsed = JSON.parse(jsonArg![0]);
    expect(parsed.level).toBe("info");
    expect(parsed.method).toBe("GET");
    expect(parsed.status).toBe(200);
    expect(parsed.requestId).toBeDefined();
    expect(parsed.endpoint).toBe("metric");
    expect(parsed.timestamp).toBeDefined();

    logSpy.mockRestore();
  });

  it("invokes custom callback when queryLogging is a function", async () => {
    const captured: ServeQueryEvent[] = [];

    const api = defineServe({
      queryLogging: (event) => captured.push(event),
      queries: {
        metric: { query: async () => ({ value: 1 }) },
      },
    });

    api.route("/metric", api.queries.metric);
    await api.handler(createRequest({ path: "/metric" }));

    // Started events are passed to custom callbacks (unlike built-in formatters)
    expect(captured.length).toBeGreaterThanOrEqual(2);
    expect(captured.some((e) => e.status === "completed")).toBe(true);
  });

  it("warns on slow queries when slowQueryThreshold is set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const api = defineServe({
      queryLogging: true,
      slowQueryThreshold: 1, // 1ms threshold
      queries: {
        slow: {
          query: async () => {
            await new Promise((r) => setTimeout(r, 10)); // ensure > 1ms
            return { ok: true };
          },
        },
      },
    });

    api.route("/slow", api.queries.slow);
    await api.handler(createRequest({ path: "/slow" }));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[hypequery/slow-query]")
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("slow")
    );

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("does not warn when query is under slowQueryThreshold", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const api = defineServe({
      queryLogging: true,
      slowQueryThreshold: 60_000, // 60 seconds — nothing will be slow
      queries: {
        fast: { query: async () => ({ ok: true }) },
      },
    });

    api.route("/fast", api.queries.fast);
    await api.handler(createRequest({ path: "/fast" }));

    // Filter to only slow-query warnings (ignore tenant warnings etc.)
    const slowQueryWarns = warnSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && msg.includes("[hypequery/slow-query]")
    );
    expect(slowQueryWarns).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
