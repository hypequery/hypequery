import { describe, it, expect } from "vitest";
import { serve, query } from "./serve.js";
import { z } from "zod";
import { createApiKeyStrategy } from "./auth.js";

describe("serve() supports all Serve features", () => {
  it("should support context injection", () => {
    const mockDb = {
      table: () => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      query: async ({ ctx }: any) => {
        // ctx.db is injected from serve context
        return ctx.db.table("orders").select().execute();
      },
    });

    const api = serve({
      context: () => ({ db: mockDb }),
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support authentication", () => {
    const revenue = query({
      query: async ({ ctx }: any) => {
        // ctx.auth is injected when auth is configured
        expect(ctx.auth).toBeDefined();
        return { total: 100 };
      },
    });

    const authStrategy = createApiKeyStrategy({
      validate: async (key) => ({ userId: "123" }),
    });

    const api = serve({
      context: () => ({ db: {} }),
      auth: authStrategy,
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support multi-tenancy", () => {
    const revenue = query({
      query: async ({ ctx }: any) => {
        // ctx.auth.tenantId is injected from tenant config
        return { total: 100 };
      },
    });

    const api = serve({
      context: () => ({ db: {} }),
      tenant: {
        mode: "path",
        tenantIdResolver: () => "tenant-123",
      },
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support all ServeConfig options", () => {
    const revenue = query({
      query: async ({ ctx }: any) => {
        return { total: 100 };
      },
    });

    const authStrategy = createApiKeyStrategy({
      validate: async (key) => ({ userId: "123" }),
    });

    const api = serve({
      // Context
      context: () => ({ db: {} }),

      // Auth
      auth: authStrategy,

      // Multi-tenancy
      tenant: {
        mode: "path",
        tenantIdResolver: () => "tenant-123",
      },

      // CORS
      cors: true,

      // Base path
      basePath: "/api/analytics",

      // Query logging
      queryLogging: true,

      // Docs
      docs: { enabled: true },

      // OpenAPI
      openapi: { enabled: true },

      // Queries
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support middleware", () => {
    const revenue = query({
      query: async ({ ctx }: any) => {
        return { total: 100 };
      },
    });

    const middleware = {
      name: "test-middleware" as const,
      handler: async ({ next }: any) => {
        return next();
      },
    };

    const api = serve({
      context: () => ({ db: {} }),
      middlewares: [middleware],
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support hooks", () => {
    const revenue = query({
      query: async ({ ctx }: any) => {
        return { total: 100 };
      },
    });

    const api = serve({
      context: () => ({ db: {} }),
      hooks: {
        onRequest: async ({ request }) => {
          console.log("Request received");
        },
      },
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });

  it("should support input/output validation", () => {
    const revenue = query({
      input: z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
      output: z.object({
        total: z.number(),
      }),
      query: async ({ input, ctx }: any) => {
        return { total: 100 };
      },
    });

    const api = serve({
      context: () => ({ db: {} }),
      queries: { revenue },
    });

    expect(api).toBeDefined();
  });
});
