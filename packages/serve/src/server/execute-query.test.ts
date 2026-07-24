import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createExecuteQuery } from "./execute-query";
import { createEndpoint } from "../endpoint";
import { ServeQueryLogger } from "../query-logger";

describe("createExecuteQuery", () => {
  it("creates a function to execute queries directly", async () => {
    const queryConfig = {
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z.object({ greeting: z.string() }),
      query: async ({ input }: { input: { name: string } }) => ({
        greeting: `Hello, ${input.name}!`,
      }),
    };

    const endpoint = createEndpoint("test", queryConfig);
    const queryEntries = { test: endpoint };

    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    const result = await executeQuery("test", {
      input: { name: "World" },
    });

    expect(result).toEqual({ greeting: "Hello, World!" });
  });

  it("throws error for non-existent query", async () => {
    const queryEntries: Record<string, any> = {};
    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    await expect(executeQuery("nonexistent" as any)).rejects.toThrow(
      "Query 'nonexistent' not found. No queries are currently registered."
    );
  });

  it("includes available query keys in missing-query errors", async () => {
    const endpoint = createEndpoint("test", {
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      query: async () => ({ ok: true }),
    });

    const queryEntries = { test: endpoint };
    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    await expect(executeQuery("nonexistent" as any)).rejects.toThrow(
      "Query 'nonexistent' not found. Available queries: test."
    );
  });

  it("passes additional context to query execution", async () => {
    let receivedContext: any = null;

    const queryConfig = {
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      query: async ({ ctx }: { ctx: { userId: string } }) => {
        receivedContext = ctx;
        return { result: "success" };
      },
    };

    const endpoint = createEndpoint("test", queryConfig);
    const queryEntries = { test: endpoint };

    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    await executeQuery("test", {
      input: {},
      context: { userId: "123" },
    });

    // The additional context should be passed through
    expect(receivedContext).toBeDefined();
    expect(receivedContext.userId).toBe("123");
  });

  it("uses a trusted in-process principal for auth, authorization, and tenancy", async () => {
    const authStrategy = vi.fn().mockResolvedValue(null);
    const endpoint = createEndpoint("secure", {
      outputSchema: z.object({
        userId: z.string(),
        tenantId: z.string(),
        contextUserId: z.string(),
      }),
      requiredRoles: ["analyst"],
      requiredScopes: ["orders:read"],
      query: async ({ ctx }: { ctx: any }) => ({
        userId: ctx.auth.userId,
        tenantId: ctx.tenantId,
        contextUserId: ctx.contextUserId,
      }),
    });
    const executeQuery = createExecuteQuery<any, any>(
      { secure: endpoint },
      [authStrategy],
      ({ auth }: { auth: any }) => ({ contextUserId: auth?.userId }),
      [],
      {
        extract: (auth: any) => auth.tenantId,
        required: true,
      },
      {},
      new ServeQueryLogger(),
    );

    await expect(executeQuery("secure", {
      trustedAuth: {
        userId: "gateway-credential",
        tenantId: "customer-42",
        roles: ["analyst"],
        scopes: ["orders:read"],
      },
    })).resolves.toEqual({
      userId: "gateway-credential",
      tenantId: "customer-42",
      contextUserId: "gateway-credential",
    });
    expect(authStrategy).not.toHaveBeenCalled();
  });

  it("still enforces endpoint permissions for a trusted principal", async () => {
    const endpoint = createEndpoint("secure", {
      outputSchema: z.object({ ok: z.boolean() }),
      requiredScopes: ["orders:read"],
      query: async () => ({ ok: true }),
    });
    const executeQuery = createExecuteQuery<any, any>(
      { secure: endpoint },
      [],
      undefined,
      [],
      undefined,
      {},
      new ServeQueryLogger(),
    );

    await expect(executeQuery("secure", {
      trustedAuth: { scopes: ["metrics:read"] },
    })).rejects.toMatchObject({
      type: "FORBIDDEN",
      status: 403,
    });
  });

  it("emits query events to logger", async () => {
    const queryConfig = {
      inputSchema: z.object({}),
      outputSchema: z.object({ result: z.string() }),
      query: async () => ({ result: "test" }),
    };

    const endpoint = createEndpoint("test", queryConfig);
    const queryEntries = { test: endpoint };

    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const events: any[] = [];
    queryLogger.on((event) => events.push(event));

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    await executeQuery("test", { input: {} });

    // Should have started and completed events
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.status === "started")).toBe(true);
    expect(events.some((e) => e.status === "completed")).toBe(true);
  });

  it("converts error responses to thrown errors", async () => {
    const queryConfig = {
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      query: async () => {
        throw new Error("Query failed");
      },
    };

    const endpoint = createEndpoint("test", queryConfig);
    const queryEntries = { test: endpoint };

    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    await expect(executeQuery("test", { input: {} })).rejects.toThrow("Query failed");
  });

  it("preserves error type and details from response", async () => {
    const queryConfig = {
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      query: async () => {
        throw new Error("Validation error");
      },
    };

    const endpoint = createEndpoint("test", queryConfig);
    const queryEntries = { test: endpoint };

    const authStrategies: any[] = [];
    const contextFactory = undefined;
    const globalMiddlewares: any[] = [];
    const tenantConfig = undefined;
    const hooks = {};
    const queryLogger = new ServeQueryLogger();

    const executeQuery = createExecuteQuery<any, any>(
      queryEntries,
      authStrategies,
      contextFactory,
      globalMiddlewares,
      tenantConfig,
      hooks,
      queryLogger,
    );

    try {
      await executeQuery("test", { input: {} });
      expect.fail("Should have thrown");
    } catch (error: any) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe("Validation error");
    }
  });
});
