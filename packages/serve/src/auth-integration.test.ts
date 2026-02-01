import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { initServe } from "./server";
import type { AuthContext, AuthContextWithRoles, AuthContextWithScopes, ServeRequest } from "./types";

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

interface TestAuth extends AuthContext {
  userId: string;
  roles?: string[];
  scopes?: string[];
}

const alwaysAuth = (auth: TestAuth) => async () => auth;

describe("Auth Guards - Integration Tests", () => {
  describe("Full request lifecycle with .requireRole()", () => {
    it("handles complete request flow with valid role", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          adminMetrics: query
            .requireRole("admin")
            .query(async ({ ctx }) => ({ data: "admin-data", db: ctx.db })),
        },
      });

      api.route("/admin-metrics", api.queries.adminMetrics);

      // Set up auth strategy
      api.useAuth(alwaysAuth({ userId: "user1", roles: ["admin"] }));

      const response = await api.handler(createRequest({ path: "/admin-metrics" }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ data: "admin-data", db: {} });
    });

    it("handles complete request flow with invalid role", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
        security: { verboseAuthErrors: true },
      });

      const api = define({
        queries: {
          adminMetrics: query
            .requireRole("admin")
            .query(async () => ({ data: "admin-data" })),
        },
      });

      api.route("/admin-metrics", api.queries.adminMetrics);
      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin-metrics" }));

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          type: "FORBIDDEN",
          details: {
            reason: "missing_role",
            required: ["admin"],
            actual: ["viewer"],
          },
        },
      });
    });
  });

  describe("Full request lifecycle with .requireScope()", () => {
    it("handles complete request flow with all required scopes", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
        security: { verboseAuthErrors: true },
      });

      const api = define({
        queries: {
          exportData: query
            .requireScope("read:metrics", "export:data")
            .query(async () => ({ url: "export-url" })),
        },
      });

      api.route("/export", api.queries.exportData);
      api.useAuth(
        alwaysAuth({
          userId: "user1",
          scopes: ["read:metrics", "export:data", "write:metrics"],
        })
      );

      const response = await api.handler(createRequest({ path: "/export" }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ url: "export-url" });
    });

    it("handles complete request flow with missing scope", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
        security: { verboseAuthErrors: true },
      });

      const api = define({
        queries: {
          exportData: query
            .requireScope("read:metrics", "export:data")
            .query(async () => ({ url: "export-url" })),
        },
      });

      api.route("/export", api.queries.exportData);
      api.useAuth(alwaysAuth({ userId: "user1", scopes: ["read:metrics"] }));

      const response = await api.handler(createRequest({ path: "/export" }));

      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          type: "FORBIDDEN",
          details: {
            reason: "missing_scope",
            required: ["read:metrics", "export:data"],
            actual: ["read:metrics"],
          },
        },
      });
    });
  });

  describe("Chained guards integration", () => {
    it("enforces both .requireRole() and .requireScope()", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api1 = define({
        queries: {
          adminExport: query
            .requireRole("admin")
            .requireScope("export:data")
            .query(async () => ({ result: "sensitive-export" })),
        },
      });

      api1.route("/admin-export", api1.queries.adminExport);

      // Test with both role and scope - should pass
      api1.useAuth(
        alwaysAuth({
          userId: "user1",
          roles: ["admin"],
          scopes: ["export:data"],
        })
      );

      const response1 = await api1.handler(createRequest({ path: "/admin-export" }));
      expect(response1.status).toBe(200);
      expect(response1.body).toEqual({ result: "sensitive-export" });

      // Test with role but missing scope - should fail
      const api2 = define({
        queries: {
          adminExport: query
            .requireRole("admin")
            .requireScope("export:data")
            .query(async () => ({ result: "sensitive-export" })),
        },
      });

      api2.route("/admin-export", api2.queries.adminExport);
      api2.useAuth(
        alwaysAuth({
          userId: "user1",
          roles: ["admin"],
          scopes: ["read:metrics"],
        })
      );

      const response2 = await api2.handler(createRequest({ path: "/admin-export" }));
      expect(response2.status).toBe(403);
      expect(response2.body.error.details.reason).toBe("missing_scope");

      // Test with scope but wrong role - should fail
      const api3 = define({
        queries: {
          adminExport: query
            .requireRole("admin")
            .requireScope("export:data")
            .query(async () => ({ result: "sensitive-export" })),
        },
      });

      api3.route("/admin-export", api3.queries.adminExport);
      api3.useAuth(
        alwaysAuth({
          userId: "user1",
          roles: ["viewer"],
          scopes: ["export:data"],
        })
      );

      const response3 = await api3.handler(createRequest({ path: "/admin-export" }));
      expect(response3.status).toBe(403);
      expect(response3.body.error.details.reason).toBe("missing_role");
    });
  });

  describe("Global auth + per-endpoint guards interaction", () => {
    it("applies global auth strategy and respects .public()", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          publicHealth: query.public().query(async () => ({ status: "ok" })),
          protectedData: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/health", api.queries.publicHealth);
      api.route("/protected", api.queries.protectedData);

      // Global auth that always fails
      api.useAuth(async () => null);

      // Public endpoint should work even though auth fails
      const response1 = await api.handler(createRequest({ path: "/health" }));
      expect(response1.status).toBe(200);
      expect(response1.body).toEqual({ status: "ok" });

      // Protected endpoint should fail
      const response2 = await api.handler(createRequest({ path: "/protected" }));
      expect(response2.status).toBe(401);
    });

    it("applies global auth with per-endpoint .requireRole()", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          protectedData: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/protected", api.queries.protectedData);

      // Global auth that provides viewer role
      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/protected" }));
      expect(response.status).toBe(403);
      expect(response.body.error.details.reason).toBe("missing_role");
    });
  });

  describe("Typed auth context integration", () => {
    it("works with typed auth and guards", async () => {
      type AppRole = "admin" | "editor" | "viewer";
      type AppScope = "read:data" | "write:data" | "delete:data";
      type AppAuth = AuthContextWithRoles<AppRole> & AuthContextWithScopes<AppScope>;

      const { define, query } = initServe<AppAuth>({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          adminWrite: query
            .requireRole("admin")
            .requireScope("write:data")
            .query(async () => ({ success: true })),
        },
      });

      api.route("/admin-write", api.queries.adminWrite);

      // Set up typed auth
      api.useAuth(
        async () =>
          ({
            userId: "user1",
            roles: ["admin"],
            scopes: ["write:data"],
          }) as AppAuth
      );

      const response = await api.handler(createRequest({ path: "/admin-write" }));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
    });
  });

  describe("Auth failure hooks integration", () => {
    it("fires onAuthFailure for missing credentials", async () => {
      const onAuthFailure = vi.fn();
      const onAuthorizationFailure = vi.fn();

      const { define, query } = initServe({
        context: () => ({ db: {} }),
        hooks: {
          onAuthFailure,
          onAuthorizationFailure,
        },
      });

      const api = define({
        queries: {
          protected: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/protected", api.queries.protected);

      // Auth strategy that always fails
      api.useAuth(async () => null);

      const response = await api.handler(createRequest({ path: "/protected" }));

      expect(response.status).toBe(401);
      expect(onAuthFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "MISSING",
        })
      );
      expect(onAuthorizationFailure).not.toHaveBeenCalled();
    });

    it("fires onAuthorizationFailure for wrong role", async () => {
      const onAuthFailure = vi.fn();
      const onAuthorizationFailure = vi.fn();

      const { define, query } = initServe({
        context: () => ({ db: {} }),
        hooks: {
          onAuthFailure,
          onAuthorizationFailure,
        },
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/admin", api.queries.adminOnly);

      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin" }));

      expect(response.status).toBe(403);
      expect(onAuthFailure).not.toHaveBeenCalled();
      expect(onAuthorizationFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "MISSING_ROLE",
          required: ["admin"],
          actual: ["viewer"],
        })
      );
    });

    it("fires onAuthorizationFailure for missing scope", async () => {
      const onAuthorizationFailure = vi.fn();

      const { define, query } = initServe({
        context: () => ({ db: {} }),
        hooks: {
          onAuthorizationFailure,
        },
      });

      const api = define({
        queries: {
          exportData: query
            .requireScope("read:metrics", "export:data")
            .query(async () => ({ url: "export-url" })),
        },
      });

      api.route("/export", api.queries.exportData);

      api.useAuth(alwaysAuth({ userId: "user1", scopes: ["read:metrics"] }));

      const response = await api.handler(createRequest({ path: "/export" }));

      expect(response.status).toBe(403);
      expect(onAuthorizationFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "MISSING_SCOPE",
        })
      );
    });
  });

  // Note: Testing multiple auth strategies is covered in other test files

  describe("Authorization with input validation", () => {
    it("checks authorization before input validation", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          protected: query
            .requireRole("admin")
            .input(z.object({ id: z.string() }))
            .query(async () => ({ data: "secret" })),
        },
      });

      api.route("/protected", api.queries.protected);

      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      // Invalid input should not be checked - auth fails first
      const response = await api.handler(
        createRequest({
          path: "/protected",
          body: { id: 123 }, // Invalid: should be string
        })
      );

      expect(response.status).toBe(403); // Auth failure, not validation error
      expect(response.body.error.type).toBe("FORBIDDEN");
    });
  });

  describe("verboseAuthErrors security option", () => {
    it("returns detailed auth errors when verboseAuthErrors is true", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
        security: {
          verboseAuthErrors: true,
        },
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin" }));

      expect(response.status).toBe(403);
      expect(response.body.error.message).toBe("Missing required role: admin");
      expect(response.body.error.details.required).toEqual(["admin"]);
      expect(response.body.error.details.actual).toEqual(["viewer"]);
    });

    it("returns generic auth errors when verboseAuthErrors is false (default)", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ data: "secret" })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "user1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin" }));

      expect(response.status).toBe(403);
      expect(response.body.error.message).toBe("Insufficient permissions");
      expect(response.body.error.details.reason).toBe("missing_role");
      expect(response.body.error.details.required).toBeUndefined();
      expect(response.body.error.details.actual).toBeUndefined();
    });

    it("returns generic auth errors for missing scopes by default", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          writeOnly: query.requireScope("write:data").query(async () => ({ success: true })),
        },
      });

      api.route("/write", api.queries.writeOnly);
      api.useAuth(alwaysAuth({ userId: "user1", scopes: ["read:data"] }));

      const response = await api.handler(createRequest({ path: "/write" }));

      expect(response.status).toBe(403);
      expect(response.body.error.message).toBe("Insufficient permissions");
      expect(response.body.error.details.reason).toBe("missing_scope");
    });

    it("returns generic auth errors for missing authentication by default", async () => {
      const { define, query } = initServe({
        context: () => ({ db: {} }),
      });

      const api = define({
        queries: {
          protected: query.requireAuth().query(async () => ({ data: "secret" })),
        },
      });

      api.route("/protected", api.queries.protected);
      api.useAuth(async () => null); // No auth

      const response = await api.handler(createRequest({ path: "/protected" }));

      expect(response.status).toBe(401);
      expect(response.body.error.message).toBe("Access denied");
    });
  });
});
