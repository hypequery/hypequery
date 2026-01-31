import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineServe } from "./server";
import type { HttpMethod, ServeRequest } from "./types";

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
});

describe("auto-routing", () => {
  it("auto-registers routes using query key as path with POST method by default", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
        passengerStats: {
          query: async () => ({ avg: 1.5 }),
        },
      },
    });

    // Should be reachable at POST /weeklyRevenue without calling .route()
    const revenue = await api.handler(
      createRequest({ method: "POST", path: "/weeklyRevenue" })
    );
    expect(revenue.status).toBe(200);
    expect(revenue.body).toEqual({ total: 4200 });

    const stats = await api.handler(
      createRequest({ method: "POST", path: "/passengerStats" })
    );
    expect(stats.status).toBe(200);
    expect(stats.body).toEqual({ avg: 1.5 });
  });

  it("uses the query-defined method when explicitly set", async () => {
    const api = defineServe({
      queries: {
        getMetrics: {
          method: "GET",
          query: async () => ({ data: [] }),
        },
        createReport: {
          method: "PUT",
          query: async () => ({ created: true }),
        },
      },
    });

    const getResponse = await api.handler(
      createRequest({ method: "GET", path: "/getMetrics" })
    );
    expect(getResponse.status).toBe(200);

    const putResponse = await api.handler(
      createRequest({ method: "PUT", path: "/createReport" })
    );
    expect(putResponse.status).toBe(200);

    // POST should not match since method was explicitly set
    const wrongMethod = await api.handler(
      createRequest({ method: "POST", path: "/getMetrics" })
    );
    expect(wrongMethod.status).toBe(404);
  });

  it("manual .route() replaces the auto-generated route", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
      },
    });

    // Override auto-route with custom path
    api.route("/metrics/weekly", api.queries.weeklyRevenue);

    // Auto-route should no longer exist
    const autoRoute = await api.handler(
      createRequest({ method: "POST", path: "/weeklyRevenue" })
    );
    expect(autoRoute.status).toBe(404);

    // Manual route should work (uses endpoint.method which defaults to GET from createEndpoint)
    const manualRoute = await api.handler(
      createRequest({ method: "GET", path: "/metrics/weekly" })
    );
    expect(manualRoute.status).toBe(200);
    expect(manualRoute.body).toEqual({ total: 4200 });
  });

  it("manual .route() with method override replaces auto-route", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
      },
    });

    api.route("/revenue", api.queries.weeklyRevenue, { method: "PUT" });

    // Auto-route gone
    const autoRoute = await api.handler(
      createRequest({ method: "POST", path: "/weeklyRevenue" })
    );
    expect(autoRoute.status).toBe(404);

    // Manual route at new path with overridden method
    const manualRoute = await api.handler(
      createRequest({ method: "PUT", path: "/revenue" })
    );
    expect(manualRoute.status).toBe(200);
    expect(manualRoute.body).toEqual({ total: 4200 });
  });

  it("can disable auto-routing with autoRouting: false", async () => {
    const api = defineServe({
      autoRouting: false,
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
      },
    });

    // No auto-route registered
    const response = await api.handler(
      createRequest({ method: "POST", path: "/weeklyRevenue" })
    );
    expect(response.status).toBe(404);

    // Must register manually
    api.route("/revenue", api.queries.weeklyRevenue);
    const manual = await api.handler(
      createRequest({ method: "GET", path: "/revenue" })
    );
    expect(manual.status).toBe(200);
  });

  it("populates _routeConfig for auto-routed queries", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
        dailyStats: {
          method: "GET",
          query: async () => ({ count: 10 }),
        },
      },
    });

    // _routeConfig should be populated by auto-routing
    expect(api._routeConfig).toEqual({
      weeklyRevenue: { method: "POST" },
      dailyStats: { method: "GET" },
    });
  });

  it("updates _routeConfig when manual .route() overrides auto-route", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
        dailyStats: {
          query: async () => ({ count: 10 }),
        },
      },
    });

    // Override one query
    api.route("/custom-revenue", api.queries.weeklyRevenue, { method: "GET" });

    expect(api._routeConfig).toEqual({
      weeklyRevenue: { method: "GET" },   // Updated by manual .route()
      dailyStats: { method: "POST" },      // Still auto-routed
    });
  });

  it("auto-routes appear in OpenAPI spec", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
          description: "Weekly revenue totals",
          outputSchema: z.object({ total: z.number() }),
        },
      },
    });

    const response = await api.handler(createRequest({ path: "/openapi.json" }));
    expect(response.status).toBe(200);

    const spec = response.body as any;
    const autoRoutePath = `${BASE_PATH}/weeklyRevenue`;
    expect(spec.paths[autoRoutePath]).toBeDefined();
    expect(spec.paths[autoRoutePath].post).toBeDefined();
  });

  it("auto-routes appear in describe() output", async () => {
    const api = defineServe({
      queries: {
        weeklyRevenue: {
          query: async () => ({ total: 4200 }),
        },
      },
    });

    const description = api.describe();
    const revenueQuery = description.queries.find((q) => q.key === "weeklyRevenue");
    expect(revenueQuery).toBeDefined();
    expect(revenueQuery?.path).toBe(`${BASE_PATH}/weeklyRevenue`);
    expect(revenueQuery?.method).toBe("POST");
  });

  it("auto-routing works with input validation", async () => {
    const api = defineServe({
      queries: {
        report: {
          query: async ({ input }) => ({ from: input.from }),
          inputSchema: z.object({ from: z.string() }),
        },
      },
    });

    // Invalid input
    const invalid = await api.handler(
      createRequest({ method: "POST", path: "/report" })
    );
    expect(invalid.status).toBe(400);

    // Valid input
    const valid = await api.handler(
      createRequest({
        method: "POST",
        path: "/report",
        body: { from: "2024-01-01" },
      })
    );
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ from: "2024-01-01" });
  });

  it("auto-routing works with auth", async () => {
    const api = defineServe({
      queries: {
        secureMetric: {
          query: async () => ({ ok: true }),
        },
      },
    });

    api.useAuth(async ({ request }) => {
      const key = request.headers["x-api-key"];
      return key === "secret" ? { apiKey: key } : null;
    });

    const unauthorized = await api.handler(
      createRequest({ method: "POST", path: "/secureMetric" })
    );
    expect(unauthorized.status).toBe(401);

    const authorized = await api.handler(
      createRequest({
        method: "POST",
        path: "/secureMetric",
        headers: { "x-api-key": "secret" },
      })
    );
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ ok: true });
  });

  it("auto-routing works with context", async () => {
    const api = defineServe({
      context: () => ({ env: "test" }),
      queries: {
        info: {
          query: async ({ ctx }) => ({ env: ctx.env }),
        },
      },
    });

    const response = await api.handler(
      createRequest({ method: "POST", path: "/info" })
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ env: "test" });
  });

  it("only the overridden query loses its auto-route; others remain", async () => {
    const api = defineServe({
      queries: {
        alpha: {
          query: async () => ({ id: "alpha" }),
        },
        beta: {
          query: async () => ({ id: "beta" }),
        },
        gamma: {
          query: async () => ({ id: "gamma" }),
        },
      },
    });

    // Override only beta
    api.route("/custom-beta", api.queries.beta);

    // alpha and gamma auto-routes still work
    const alpha = await api.handler(
      createRequest({ method: "POST", path: "/alpha" })
    );
    expect(alpha.status).toBe(200);
    expect(alpha.body).toEqual({ id: "alpha" });

    const gamma = await api.handler(
      createRequest({ method: "POST", path: "/gamma" })
    );
    expect(gamma.status).toBe(200);
    expect(gamma.body).toEqual({ id: "gamma" });

    // beta auto-route is gone
    const betaAuto = await api.handler(
      createRequest({ method: "POST", path: "/beta" })
    );
    expect(betaAuto.status).toBe(404);

    // beta manual route works
    const betaManual = await api.handler(
      createRequest({ method: "GET", path: "/custom-beta" })
    );
    expect(betaManual.status).toBe(200);
    expect(betaManual.body).toEqual({ id: "beta" });
  });

  it("execute() still works with auto-routing enabled", async () => {
    const api = defineServe({
      queries: {
        metric: {
          inputSchema: z.object({ limit: z.number().default(5) }),
          query: async ({ input }) =>
            Array.from({ length: input.limit }).map((_, i) => ({ value: i })),
        },
      },
    });

    const result = await api.execute("metric", { input: { limit: 2 } });
    expect(result).toEqual([{ value: 0 }, { value: 1 }]);
  });
});
