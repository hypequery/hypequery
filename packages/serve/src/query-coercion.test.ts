import { describe, it, expect } from "vitest";
import { z } from "zod";
import { coerceQueryInput } from "./query-coercion.js";

/** Coercion is only useful if the schema then accepts the result. */
const parse = (schema: z.ZodTypeAny, raw: unknown) =>
  schema.safeParse(coerceQueryInput(schema, raw));

describe("coerceQueryInput", () => {
  it("coerces the numeric case that made GET endpoints unusable", () => {
    const schema = z.object({ limit: z.number().int() });

    // Before: `expected number, received string`.
    expect(parse(schema, { limit: "8" })).toMatchObject({
      success: true,
      data: { limit: 8 },
    });
  });

  it("coerces through optional, default, and nullable wrappers", () => {
    const schema = z.object({
      a: z.number().optional(),
      b: z.number().default(10),
      c: z.number().nullable(),
    });

    expect(parse(schema, { a: "1", b: "2", c: "3" })).toMatchObject({
      success: true,
      data: { a: 1, b: 2, c: 3 },
    });
  });

  it("applies defaults when the key is absent", () => {
    const schema = z.object({ limit: z.number().default(10) });

    expect(parse(schema, {})).toMatchObject({ success: true, data: { limit: 10 } });
  });

  it("coerces booleans from the forms a query string can carry", () => {
    const schema = z.object({ flag: z.boolean() });

    for (const [raw, expected] of [
      ["true", true],
      ["TRUE", true],
      ["1", true],
      ["false", false],
      ["0", false],
    ] as const) {
      expect(parse(schema, { flag: raw })).toMatchObject({
        success: true,
        data: { flag: expected },
      });
    }
  });

  it("wraps a single repeated-key value into an array", () => {
    const schema = z.object({ ids: z.array(z.number()) });

    // One `?ids=1` arrives as a scalar; the schema wants a list.
    expect(parse(schema, { ids: "1" })).toMatchObject({
      success: true,
      data: { ids: [1] },
    });
    expect(parse(schema, { ids: ["1", "2"] })).toMatchObject({
      success: true,
      data: { ids: [1, 2] },
    });
  });

  it("coerces dates", () => {
    const schema = z.object({ since: z.date() });
    const result = parse(schema, { since: "2026-01-01T00:00:00.000Z" });

    expect(result.success).toBe(true);
    expect((result as { data: { since: Date } }).data.since.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });

  it("preserves raw query values for preprocessors", () => {
    const schema = z.object({
      tags: z.preprocess(
        (value) => typeof value === "string" ? value.split(",") : value,
        z.array(z.string()),
      ),
    });

    expect(parse(schema, { tags: "a,b" })).toMatchObject({
      success: true,
      data: { tags: ["a", "b"] },
    });
  });

  it("lets a root preprocessor own coercion for its subtree", () => {
    let received: unknown;
    const schema = z.preprocess((value) => {
      received = value;
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const input = value as Record<string, unknown>;
      return {
        ...input,
        limit: typeof input.limit === "string" ? Number(input.limit) : input.limit,
      };
    }, z.object({ limit: z.number() }));

    expect(parse(schema, { limit: "8" })).toMatchObject({
      success: true,
      data: { limit: 8 },
    });
    expect(received).toEqual({ limit: "8" });
  });

  it("does not invent a zero bigint for an empty query value", () => {
    const schema = z.object({ id: z.bigint() });

    for (const id of ["", "  "]) {
      const result = parse(schema, { id });
      expect(result.success).toBe(false);
      expect((result as { error: z.ZodError }).error.issues[0]).toMatchObject({
        code: "invalid_type",
        expected: "bigint",
        received: "string",
        path: ["id"],
      });
    }
  });

  it("coerces through branded and readonly wrappers", () => {
    const schema = z.object({
      id: z.number().brand<"UserId">(),
      page: z.number().readonly(),
    });

    expect(parse(schema, { id: "5", page: "2" })).toMatchObject({
      success: true,
      data: { id: 5, page: 2 },
    });
  });

  it("coerces values declared by an object catchall schema", () => {
    const schema = z.object({}).catchall(z.number());

    expect(parse(schema, { first: "1", second: "2" })).toMatchObject({
      success: true,
      data: { first: 1, second: 2 },
    });
  });

  it("leaves strings and enums alone", () => {
    const schema = z.object({ name: z.string(), status: z.enum(["a", "b"]) });

    expect(coerceQueryInput(schema, { name: "1", status: "a" })).toEqual({
      name: "1",
      status: "a",
    });
  });

  it("passes unconvertible values through so zod reports the real error", () => {
    const schema = z.object({ limit: z.number() });
    const result = parse(schema, { limit: "abc" });

    expect(result.success).toBe(false);
    expect((result as { error: z.ZodError }).error.issues[0]).toMatchObject({
      code: "invalid_type",
      expected: "number",
      received: "string",
      path: ["limit"],
    });
  });

  it("leaves unknown keys for the schema to handle", () => {
    const schema = z.object({ limit: z.number() });

    expect(coerceQueryInput(schema, { limit: "5", stray: "x" })).toEqual({
      limit: 5,
      stray: "x",
    });
  });

  it("returns the payload untouched when there is no schema", () => {
    expect(coerceQueryInput(undefined, { limit: "5" })).toEqual({ limit: "5" });
  });

  it("returns the payload untouched for non-object schemas and payloads", () => {
    expect(coerceQueryInput(z.string(), { limit: "5" })).toEqual({ limit: "5" });
    expect(coerceQueryInput(z.object({ a: z.number() }), "nope")).toBe("nope");
    expect(coerceQueryInput(z.object({ a: z.number() }), null)).toBe(null);
  });

  it("does not mutate the input object", () => {
    const raw = { limit: "5" };
    coerceQueryInput(z.object({ limit: z.number() }), raw);

    expect(raw).toEqual({ limit: "5" });
  });
});
