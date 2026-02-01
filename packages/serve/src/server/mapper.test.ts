import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mapEndpointToToolkit } from "./mapper";
import type { HttpMethod, ServeEndpoint } from "../types";

describe("mapEndpointToToolkit", () => {
  it("maps endpoint to toolkit description", () => {
    const endpoint = {
      key: "testQuery",
      method: "GET" as const,
      inputSchema: z.object({ name: z.string() }),
      outputSchema: z.object({ greeting: z.string() }),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/test",
        method: "GET" as HttpMethod,
        name: "Test Query",
        summary: "Test summary",
        description: "Test description",
        tags: ["test", "demo"],
        requiresAuth: false,
        deprecated: false,
        visibility: "public" as const,
      },
      cacheTtlMs: null,
      tenant: undefined,
    };

    const result = mapEndpointToToolkit(endpoint);

    expect(result).toEqual({
      key: "testQuery",
      path: "/api/test",
      method: "GET",
      name: "Test Query",
      summary: "Test summary",
      description: "Test description",
      tags: ["test", "demo"],
      visibility: "public",
      requiresAuth: false,
      requiresTenant: undefined,
      inputSchema: expect.any(Object), // JSON schema
      outputSchema: expect.any(Object), // JSON schema
      custom: undefined,
    });
  });

  it("converts Zod schemas to JSON schemas", () => {
    const endpoint = {
      key: "schemaTest",
      method: "POST" as const,
      inputSchema: z.object({
        name: z.string(),
        age: z.number().optional(),
      }),
      outputSchema: z.object({
        success: z.boolean(),
      }),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/schemaTest",
        method: "POST" as HttpMethod,
        name: "Schema Test",
        summary: "",
        description: "",
        tags: [],
        requiresAuth: false,
        deprecated: false,
        visibility: "public" as const,
      },
      cacheTtlMs: null,
    };

    const result = mapEndpointToToolkit(endpoint);

    // Verify inputSchema was converted
    expect(result.inputSchema).toBeDefined();
    expect(typeof result.inputSchema).toBe("object");

    // Verify outputSchema was converted
    expect(result.outputSchema).toBeDefined();
    expect(typeof result.outputSchema).toBe("object");
  });

  it("handles endpoints with no schemas", () => {
    const endpoint = {
      key: "noSchema",
      method: "GET" as const,
      inputSchema: undefined,
      outputSchema: z.any(),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/noSchema",
        method: "GET" as HttpMethod,
        name: "No Schema",
        summary: "",
        description: "",
        tags: [],
        requiresAuth: false,
        deprecated: false,
        visibility: "public" as const,
      },
      cacheTtlMs: null,
    };

    const result = mapEndpointToToolkit(endpoint);

    expect(result.inputSchema).toBeUndefined();
    expect(result.outputSchema).toBeDefined();
  });

  it("includes requiresTenant when tenant config is present", () => {
    const endpoint = {
      key: "tenantQuery",
      method: "GET" as const,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/tenant",
        method: "GET" as HttpMethod,
        name: "Tenant Query",
        summary: "",
        description: "",
        tags: [],
        requiresAuth: false,
        deprecated: false,
        visibility: "public",
      },
      cacheTtlMs: null,
      tenant: {
        required: true,
        extract: (auth: any) => auth.tenantId,
        mode: "auto-inject" as const,
        column: "tenant_id",
      },
    };

    const result = mapEndpointToToolkit(endpoint);

    expect(result.requiresTenant).toBe(true);
  });

  it("includes requiresTenant=false when optional tenant", () => {
    const endpoint = {
      key: "optionalTenant",
      method: "GET" as const,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/optionalTenant",
        method: "GET" as HttpMethod,
        name: "Optional Tenant",
        summary: "",
        description: "",
        tags: [],
        requiresAuth: false,
        deprecated: false,
        visibility: "public" as const,
      },
      cacheTtlMs: null,
      tenant: {
        required: false,
        extract: (auth: any) => auth.tenantId,
        mode: "manual" as const,
        column: "tenant_id",
      },
    };

    const result = mapEndpointToToolkit(endpoint);

    expect(result.requiresTenant).toBe(false);
  });

  it("includes custom metadata", () => {
    const endpoint = {
      key: "custom",
      method: "GET" as const,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      handler: async () => ({}),
      query: undefined,
      middlewares: [],
      auth: null,
      metadata: {
        path: "/api/custom",
        method: "GET" as HttpMethod,
        name: "Custom",
        summary: "",
        description: "",
        tags: [],
        requiresAuth: false,
        deprecated: false,
        visibility: "public" as const,
        custom: {
          category: "analytics",
          cacheTtl: 3600,
        },
      },
      cacheTtlMs: null,
    };

    const result = mapEndpointToToolkit(endpoint);

    expect(result.custom).toEqual({
      category: "analytics",
      cacheTtl: 3600,
    });
  });
});
