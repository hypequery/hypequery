import { describe, it, expect, vi } from "vitest";
import {
  createApiKeyStrategy,
  createBearerTokenStrategy,
  type ApiKeyStrategyOptions,
  type BearerTokenStrategyOptions,
} from "./auth.js";
import type { ServeRequest } from "./types.js";

// Helper to create a mock ServeRequest
function createMockRequest(
  headers: Record<string, string | undefined> = {},
  query: Record<string, string | string[] | undefined> = {}
): ServeRequest {
  return {
    headers,
    query,
    method: "GET",
    url: "/",
    body: undefined,
  };
}

describe("Authentication Strategies", () => {
  describe("createApiKeyStrategy", () => {
    describe("Header extraction", () => {
      it("extracts from Authorization header with Bearer prefix", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer my-api-key" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("my-api-key", request);
      });

      it("extracts from Authorization header without Bearer prefix", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "plain-api-key" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("plain-api-key", request);
      });

      it("extracts from custom header", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          header: "x-api-key",
          validate,
        });

        const request = createMockRequest({ "x-api-key": "custom-key" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("custom-key", request);
      });

      it("handles case-insensitive header matching", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({ validate });

        // Test with lowercase authorization header
        const request = createMockRequest({ authorization: "Bearer key123" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("key123", request);
        expect(result).toEqual({ userId: "123" });
      });

      it("handles custom header with case-insensitive fallback", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          header: "X-API-Key",
          validate,
        });

        // Provide lowercase version
        const request = createMockRequest({ "x-api-key": "my-key" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("my-key", request);
        expect(result).toEqual({ userId: "123" });
      });
    });

    describe("Query parameter extraction", () => {
      it("extracts from query parameter", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          queryParam: "apiKey",
          validate,
        });

        const request = createMockRequest({}, { apiKey: "query-key" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("query-key", request);
      });

      it("prioritizes query parameter over header", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          queryParam: "apiKey",
          validate,
        });

        const request = createMockRequest(
          { authorization: "Bearer header-key" },
          { apiKey: "query-key" }
        );
        await strategy({ request });

        // Should use query param, not header
        expect(validate).toHaveBeenCalledWith("query-key", request);
      });

      it("falls back to header when query param is not a string", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          queryParam: "apiKey",
          validate,
        });

        // Query param is an array (multiple values)
        const request = createMockRequest(
          { authorization: "Bearer header-key" },
          { apiKey: ["key1", "key2"] }
        );
        await strategy({ request });

        // Should fall back to header
        expect(validate).toHaveBeenCalledWith("header-key", request);
      });

      it("falls back to header when query param is missing", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createApiKeyStrategy({
          queryParam: "apiKey",
          validate,
        });

        const request = createMockRequest({ authorization: "Bearer header-key" }, {});
        await strategy({ request });

        // Should fall back to header
        expect(validate).toHaveBeenCalledWith("header-key", request);
      });
    });

    describe("Missing key handling", () => {
      it("returns null when no key is found", async () => {
        const validate = vi.fn();
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({}, {});
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });

      it("returns null when header is not a string", async () => {
        const validate = vi.fn();
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: undefined }, {});
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });
    });

    describe("Validation function", () => {
      it("calls async validate function", async () => {
        const authContext = { userId: "123", role: "admin" };
        const validate = vi.fn().mockResolvedValue(authContext);
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer key123" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("key123", request);
        expect(result).toEqual(authContext);
      });

      it("calls sync validate function", async () => {
        const authContext = { userId: "456" };
        const validate = vi.fn().mockReturnValue(authContext);
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "key456" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("key456", request);
        expect(result).toEqual(authContext);
      });

      it("returns null when validate returns null", async () => {
        const validate = vi.fn().mockResolvedValue(null);
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer invalid-key" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("invalid-key", request);
        expect(result).toBeNull();
      });

      it("returns auth context when validate succeeds", async () => {
        const authContext = { userId: "789", permissions: ["read", "write"] };
        const validate = vi.fn().mockResolvedValue(authContext);
        const strategy = createApiKeyStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer valid-key" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("valid-key", request);
        expect(result).toEqual(authContext);
      });
    });
  });

  describe("createBearerTokenStrategy", () => {
    describe("Token extraction", () => {
      it("extracts from Authorization header with Bearer prefix", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer my-token" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("my-token", request);
      });

      it("trims whitespace from token", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer   token-with-spaces   " });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("token-with-spaces", request);
      });

      it("uses custom prefix when provided", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createBearerTokenStrategy({
          prefix: "Token ",
          validate,
        });

        const request = createMockRequest({ authorization: "Token my-custom-token" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("my-custom-token", request);
      });

      it("uses custom header when provided", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createBearerTokenStrategy({
          header: "x-auth-token",
          validate,
        });

        const request = createMockRequest({ "x-auth-token": "Bearer custom-header-token" });
        await strategy({ request });

        expect(validate).toHaveBeenCalledWith("custom-header-token", request);
      });

      it("handles case-insensitive header matching", async () => {
        const validate = vi.fn().mockResolvedValue({ userId: "123" });
        const strategy = createBearerTokenStrategy({ validate });

        // Lowercase authorization header
        const request = createMockRequest({ authorization: "Bearer token123" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("token123", request);
        expect(result).toEqual({ userId: "123" });
      });
    });

    describe("Missing or invalid prefix", () => {
      it("returns null when header is missing", async () => {
        const validate = vi.fn();
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({}, {});
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });

      it("returns null when header is not a string", async () => {
        const validate = vi.fn();
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: undefined }, {});
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });

      it("returns null when prefix does not match", async () => {
        const validate = vi.fn();
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Basic some-token" });
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });

      it("returns null when token is empty after trimming", async () => {
        const validate = vi.fn();
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer   " });
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });

      it("returns null when header has no token after prefix", async () => {
        const validate = vi.fn();
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer" });
        const result = await strategy({ request });

        expect(result).toBeNull();
        expect(validate).not.toHaveBeenCalled();
      });
    });

    describe("Validation function", () => {
      it("calls async validate function", async () => {
        const authContext = { userId: "123", scope: "admin" };
        const validate = vi.fn().mockResolvedValue(authContext);
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer async-token" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("async-token", request);
        expect(result).toEqual(authContext);
      });

      it("calls sync validate function", async () => {
        const authContext = { userId: "456" };
        const validate = vi.fn().mockReturnValue(authContext);
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer sync-token" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("sync-token", request);
        expect(result).toEqual(authContext);
      });

      it("returns null when validate returns null", async () => {
        const validate = vi.fn().mockResolvedValue(null);
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer invalid-token" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("invalid-token", request);
        expect(result).toBeNull();
      });

      it("returns auth context when validate succeeds", async () => {
        const authContext = { userId: "789", email: "user@example.com" };
        const validate = vi.fn().mockResolvedValue(authContext);
        const strategy = createBearerTokenStrategy({ validate });

        const request = createMockRequest({ authorization: "Bearer valid-token" });
        const result = await strategy({ request });

        expect(validate).toHaveBeenCalledWith("valid-token", request);
        expect(result).toEqual(authContext);
      });
    });
  });
});
