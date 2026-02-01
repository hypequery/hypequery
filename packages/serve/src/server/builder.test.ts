import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createBuilderMethods } from "./builder";
import { ServeRouter } from "../router";
import { ServeQueryLogger } from "../query-logger";
import type { ServeEndpoint } from "../types";

describe("createBuilderMethods", () => {
  it("creates a properly typed builder object", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({ value: 42 });
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    // Verify all required properties exist
    expect(builder.queries).toBe(queryEntries);
    expect(builder.queryLogger).toBe(queryLogger);
    expect(builder._routeConfig).toBe(routeConfig);
    expect(builder.handler).toBe(handler);
    expect(typeof builder.route).toBe("function");
    expect(typeof builder.use).toBe("function");
    expect(typeof builder.useAuth).toBe("function");
    expect(typeof builder.execute).toBe("function");
    expect(typeof builder.run).toBe("function");
    expect(typeof builder.describe).toBe("function");
    expect(typeof builder.start).toBe("function");
  });

  it("route method returns builder for chaining", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {
      test: {
        key: "test",
        method: "GET" as const,
        inputSchema: undefined,
        outputSchema: z.any(),
        handler: async () => ({}),
        query: undefined,
        middlewares: [],
        auth: null,
        metadata: {
          path: "/test",
          method: "GET",
          name: "test",
          summary: "",
          description: "",
          tags: [],
          requiresAuth: false,
          deprecated: false,
          visibility: "public",
        },
        cacheTtlMs: null,
      },
    };
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({});
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    const result = builder.route("/custom", queryEntries.test);

    // Should return the same builder instance for chaining
    expect(result).toBe(builder);
  });

  it("use method adds middleware to global middlewares", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({});
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    const middleware = async (_ctx: any, _next: any) => {};
    const result = builder.use(middleware);

    // Should return the same builder instance for chaining
    expect(result).toBe(builder);
    expect(globalMiddlewares).toContain(middleware);
  });

  it("useAuth method adds auth strategy", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({});
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    const strategy = async () => ({ userId: "123" });
    const result = builder.useAuth(strategy);

    // Should return the same builder instance for chaining
    expect(result).toBe(builder);
    expect(authStrategies).toContain(strategy);
  });

  it("describe method returns toolkit description", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({});
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    const description = builder.describe();

    expect(description).toEqual({
      basePath: "/api",
      queries: [],
    });
  });

  it("execute and run methods delegate to executeQuery", async () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = vi.fn().mockResolvedValue({ result: "test" });
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    await builder.execute("test");
    await builder.run("test");

    expect(executeQuery).toHaveBeenCalledTimes(2);
  });

  it("start method returns a promise", () => {
    const queryEntries: Record<string, ServeEndpoint<any, any, any, any>> = {};
    const queryLogger = new ServeQueryLogger();
    const routeConfig: Record<string, { method: "GET" | "POST" }> = {};
    const router = new ServeRouter("/api");
    const authStrategies: any[] = [];
    const globalMiddlewares: any[] = [];
    const executeQuery = async () => ({});
    const handler = async () => ({ status: 200, body: {}, headers: {} });
    const basePath = "/api";

    const builder = createBuilderMethods(
      queryEntries,
      queryLogger,
      routeConfig,
      router,
      authStrategies,
      globalMiddlewares,
      executeQuery,
      handler,
      basePath,
    );

    // Verify start is a function that accepts options
    expect(typeof builder.start).toBe("function");
    // start() actually starts a server, tested in server.test.ts
  });
});
