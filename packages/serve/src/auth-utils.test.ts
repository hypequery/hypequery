import { describe, expect, it } from "vitest";

import { apiKeyAuth, AuthError, getHeader } from "./auth.js";
import type { ServeRequest } from "./types.js";

const baseRequest: ServeRequest = {
  method: "GET",
  path: "/",
  query: {},
  headers: {},
};

describe("getHeader", () => {
  it("returns headers case-insensitively", () => {
    const request = {
      ...baseRequest,
      headers: { "X-Tenant-Key": "abc" } as any,
    } satisfies ServeRequest;

    expect(getHeader(request, "x-tenant-key")).toBe("abc");
  });

  it("returns the first value for array headers", () => {
    const request = {
      ...baseRequest,
      headers: { "x-tenant-key": ["first", "second"] } as any,
    } satisfies ServeRequest;

    expect(getHeader(request, "x-tenant-key")).toBe("first");
  });
});

describe("apiKeyAuth", () => {
  it("throws AuthError for missing keys by default", async () => {
    const strategy = apiKeyAuth({
      header: "x-tenant-key",
      validate: async () => ({ userId: "u1" }),
    });

    await expect(strategy({ request: baseRequest, endpoint: undefined as any }))
      .rejects.toMatchObject({
        name: "AuthError",
        reason: "MISSING",
      });
  });

  it("throws AuthError for invalid keys", async () => {
    const strategy = apiKeyAuth({
      header: "x-tenant-key",
      validate: async () => null,
    });

    const request = {
      ...baseRequest,
      headers: { "x-tenant-key": "bad" },
    } satisfies ServeRequest;

    await expect(strategy({ request, endpoint: undefined as any }))
      .rejects.toMatchObject({
        name: "AuthError",
        reason: "INVALID",
      });
  });

  it("returns auth context for valid keys", async () => {
    const strategy = apiKeyAuth({
      header: "x-tenant-key",
      validate: async (key) => (key === "good" ? { userId: "u1" } : null),
    });

    const request = {
      ...baseRequest,
      headers: { "x-tenant-key": "good" },
    } satisfies ServeRequest;

    await expect(strategy({ request, endpoint: undefined as any }))
      .resolves.toEqual({ userId: "u1" });
  });

  it("returns null when allowMissing is enabled", async () => {
    const strategy = apiKeyAuth({
      header: "x-tenant-key",
      allowMissing: true,
      validate: async () => ({ userId: "u1" }),
    });

    await expect(strategy({ request: baseRequest, endpoint: undefined as any }))
      .resolves.toBeNull();
  });
});
