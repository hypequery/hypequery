import { describe, it, expect } from "vitest";
import { serve, query } from "./serve.js";
import { z } from "zod";

describe("Simplified API - query() and serve()", () => {
  it("should create a query object with query()", () => {
    const mockDb = {
      table: (tableName: string) => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      name: "revenue",
      input: z.object({ startDate: z.string() }),
      query: async ({ input, ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total };
      },
    });

    expect(revenue).toBeDefined();
    expect(revenue.run).toBeDefined();
    expect(typeof revenue.run).toBe("function");
  });

  it("should run query independently with .run()", async () => {
    const mockDb = {
      table: (tableName: string) => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      input: z.object({ startDate: z.string() }),
      query: async ({ input, ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total, startDate: input.startDate };
      },
    });

    const result = await revenue.run({
      input: { startDate: "2024-01-01" },
      ctx: { db: mockDb },
    });

    expect(result).toEqual({ total: 100, startDate: "2024-01-01" });
  });

  it("should serve query objects with serve()", () => {
    const mockDb = {
      table: (tableName: string) => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      query: async ({ ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total };
      },
    });

    const api = serve({
      context: () => ({ db: mockDb }),
      queries: {
        revenue,
      },
    });

    expect(api).toBeDefined();
    expect(api.queries.revenue).toBeDefined();
  });

  it("should serve multiple query objects", () => {
    const mockDb = {
      table: (tableName: string) => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      query: async ({ ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total };
      },
    });

    const expenses = query({
      query: async ({ ctx }: any) => {
        const result = await ctx.db.table("expenses").select().execute();
        return { total: result[0].total };
      },
    });

    const api = serve({
      context: () => ({ db: mockDb }),
      queries: {
        revenue,
        expenses,
      },
    });

    expect(api).toBeDefined();
    expect(api.queries.revenue).toBeDefined();
    expect(api.queries.expenses).toBeDefined();
  });

  it("should work with queries object syntax", () => {
    const mockDb = {
      table: (tableName: string) => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      query: async ({ ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total };
      },
    });

    const api = serve({
      context: () => ({ db: mockDb }),
      queries: {
        revenue,
      },
    });

    expect(api).toBeDefined();
    expect(api.queries.revenue).toBeDefined();
  });

  it("should support optional metadata on query objects", () => {
    const mockDb = {
      table: () => ({
        select: () => ({
          execute: async () => [{ total: 100 }],
        }),
      }),
    };

    const revenue = query({
      name: "revenue",
      description: "Calculate total revenue",
      summary: "Monthly revenue calculation",
      tags: ["finance", "revenue"],
      query: async ({ ctx }: any) => {
        const result = await ctx.db.table("orders").select().execute();
        return { total: result[0].total };
      },
    });

    expect(revenue).toBeDefined();
    expect(revenue.run).toBeDefined();
  });
});
