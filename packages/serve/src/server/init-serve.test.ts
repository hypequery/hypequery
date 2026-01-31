import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initServe } from "./init-serve";

describe("initServe", () => {
  it("creates a serve initializer with typed context", () => {
    const contextFactory = async ({ request, auth }: any) => ({
      userId: auth?.userId ?? "anonymous",
      requestId: request.headers["x-request-id"],
    });

    const initializer = initServe({
      context: contextFactory,
    });

    // Should return a serve initializer with procedure, queries, and define
    expect(initializer).toBeDefined();
    expect(initializer.procedure).toBeDefined();
    expect(initializer.query).toBe(initializer.procedure);
    expect(typeof initializer.queries).toBe("function");
    expect(typeof initializer.define).toBe("function");
  });

  it("procedure builder creates typed query definitions", () => {
    const contextFactory = async () => ({
      db: { query: "SELECT 1" },
    });

    const initializer = initServe({
      context: contextFactory,
    });

    const query = initializer.procedure
      .input(z.object({ name: z.string() }))
      .output(z.object({ greeting: z.string() }))
      .query(async ({ input }) => ({
        greeting: `Hello, ${input.name}!`,
      }));

    expect(query).toBeDefined();
    expect(query.inputSchema).toBeDefined();
    expect(query.outputSchema).toBeDefined();
  });

  it("queries helper creates query definitions object", () => {
    const contextFactory = async () => ({});

    const initializer = initServe({
      context: contextFactory,
    });

    const queries = initializer.queries({
      testQuery: {
        inputSchema: z.object({}),
        outputSchema: z.object({ result: z.string() }),
        query: async () => ({ result: "test" }),
      },
    });

    expect(queries.testQuery).toBeDefined();
    expect(queries.testQuery.query).toBeDefined();
  });

  it("define creates a serve instance with context", () => {
    type Context = { userId: string };
    type Auth = { userId: string };

    const contextFactory = async (): Promise<Context> => ({
      userId: "123",
    });

    const initializer = initServe({
      context: contextFactory,
      auth: async () => ({ userId: "123" }),
    });

    const api = initializer.define({
      queries: {
        test: {
          inputSchema: z.object({}),
          outputSchema: z.object({ result: z.string() }),
          query: async ({ context }: { context: Context }) => ({
            result: context.userId,
          }),
        },
      },
    });

    expect(api).toBeDefined();
    expect(api.queries.test).toBeDefined();
    expect(typeof api.handler).toBe("function");
  });

  it("context factory is passed to queries", async () => {
    type Context = { timestamp: number };

    const contextFactory = async (): Promise<Context> => ({
      timestamp: Date.now(),
    });

    const initializer = initServe({
      context: contextFactory,
    });

    const api = initializer.define({
      queries: {
        getTime: {
          inputSchema: z.object({}),
          outputSchema: z.object({ time: z.number() }),
          query: async ({ ctx }: { ctx: Context }) => ({
            time: ctx.timestamp,
          }),
        },
      },
    });

    api.route("/time", api.queries.getTime);

    // Execute the query to verify context is passed
    const result = await api.execute("getTime", { input: {} });
    expect(result.time).toBeDefined();
    expect(typeof result.time).toBe("number");
  });

  it("supports auth context in queries", async () => {
    type Auth = { userId: string; role: string };

    const initializer = initServe({
      auth: async () => ({ userId: "123", role: "admin" }),
    });

    const api = initializer.define({
      queries: {
        whoami: {
          inputSchema: z.object({}),
          outputSchema: z.object({ userId: z.string(), role: z.string() }),
          query: async ({ ctx }: { ctx: { auth: Auth } }) => ({
            userId: ctx.auth!.userId,
            role: ctx.auth!.role,
          }),
        },
      },
    });

    api.route("/whoami", api.queries.whoami);

    const result = await api.execute("whoami", { input: {} });
    expect(result).toEqual({ userId: "123", role: "admin" });
  });

  it("works with complex query configurations", () => {
    type Context = { db: any };

    const contextFactory = async (): Promise<Context> => ({
      db: { query: "mock" },
    });

    const initializer = initServe({
      context: contextFactory,
      middlewares: [],
    });

    const procedure = initializer.procedure
      .input(z.object({ id: z.number() }))
      .output(z.object({ name: z.string() }))
      .query(async ({ input }) => ({
        name: `Item ${input.id}`,
      }));

    expect(procedure).toBeDefined();
    expect(procedure.inputSchema).toBeDefined();
    expect(procedure.outputSchema).toBeDefined();
  });

  it("handles optional context factory", () => {
    const initializer = initServe({
      context: { userId: "default" },
    });

    expect(initializer).toBeDefined();
    expect(typeof initializer.define).toBe("function");
  });

  it("passes through configuration options", () => {
    const initializer = initServe({
      basePath: "/custom",
      context: {},
      middlewares: [],
      auth: [],
      hooks: {},
      openapi: { enabled: false },
      docs: { enabled: false },
    });

    const api = initializer.define({
      queries: {
        test: {
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          query: async () => ({}),
        },
      },
    });

    expect(api).toBeDefined();
    expect(typeof api.handler).toBe("function");
  });
});
