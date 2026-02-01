import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineServe, initServe } from "./server";
import {
  requireAuthMiddleware,
  requireRoleMiddleware,
  requireScopeMiddleware,
} from "./auth";
import type { AuthContext, ServeRequest } from "./types";

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

const alwaysAuth =
  (auth: TestAuth) =>
  async () =>
    auth;

describe("Auth Guards", () => {
  describe(".requireAuth()", () => {
    it("rejects unauthenticated requests with 401", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          secret: query.requireAuth().query(async () => ({ ok: true })),
        },
      });

      api.route("/secret", api.queries.secret);
      // No auth strategy registered, so auth will always be null
      const response = await api.handler(createRequest({ path: "/secret" }));
      expect(response.status).toBe(401);
    });

    it("allows authenticated requests", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          secret: query.requireAuth().query(async () => ({ ok: true })),
        },
      });

      api.route("/secret", api.queries.secret);
      api.useAuth(alwaysAuth({ userId: "u1" }));

      const response = await api.handler(createRequest({ path: "/secret" }));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
    });
  });

  describe(".requireRole()", () => {
    it("rejects users without the required role with 403", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ admin: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "u1", roles: ["viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin" }));
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

    it("allows users with the required role", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ admin: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "u1", roles: ["admin", "viewer"] }));

      const response = await api.handler(createRequest({ path: "/admin" }));
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ admin: true });
    });

    it("allows any one of multiple required roles (OR semantics)", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          managers: query
            .requireRole("admin", "editor")
            .query(async () => ({ ok: true })),
        },
      });

      api.route("/managers", api.queries.managers);
      api.useAuth(alwaysAuth({ userId: "u1", roles: ["editor"] }));

      const response = await api.handler(createRequest({ path: "/managers" }));
      expect(response.status).toBe(200);
    });

    it("rejects users with empty roles array", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ admin: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "u1", roles: [] }));

      const response = await api.handler(createRequest({ path: "/admin" }));
      expect(response.status).toBe(403);
    });

    it("rejects users with no roles property", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ admin: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "u1" }));

      const response = await api.handler(createRequest({ path: "/admin" }));
      expect(response.status).toBe(403);
    });

    it("implies requireAuth - rejects unauthenticated requests with 401", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ admin: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      // No auth strategy — should get 401, not 403

      const response = await api.handler(createRequest({ path: "/admin" }));
      expect(response.status).toBe(401);
    });
  });

  describe(".requireScope()", () => {
    it("rejects users without all required scopes with 403", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          metrics: query
            .requireScope("read:metrics", "read:users")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/metrics", api.queries.metrics);
      api.useAuth(alwaysAuth({ userId: "u1", scopes: ["read:metrics"] }));

      const response = await api.handler(createRequest({ path: "/metrics" }));
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: {
          type: "FORBIDDEN",
          details: {
            reason: "missing_scope",
            required: ["read:metrics", "read:users"],
            actual: ["read:metrics"],
          },
        },
      });
    });

    it("allows users with all required scopes (AND semantics)", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          metrics: query
            .requireScope("read:metrics", "read:users")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/metrics", api.queries.metrics);
      api.useAuth(
        alwaysAuth({
          userId: "u1",
          scopes: ["read:metrics", "read:users", "write:metrics"],
        }),
      );

      const response = await api.handler(createRequest({ path: "/metrics" }));
      expect(response.status).toBe(200);
    });

    it("implies requireAuth - rejects unauthenticated requests with 401", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          metrics: query.requireScope("read:metrics").query(async () => ({ data: [] })),
        },
      });

      api.route("/metrics", api.queries.metrics);
      // No auth strategy

      const response = await api.handler(createRequest({ path: "/metrics" }));
      expect(response.status).toBe(401);
    });
  });

  describe(".public()", () => {
    it("allows unauthenticated access even with global auth", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          health: query.public().query(async () => ({ status: "ok" })),
          secret: query.requireAuth().query(async () => ({ secret: true })),
        },
      });

      api.route("/health", api.queries.health);
      api.route("/secret", api.queries.secret);
      // Auth that always fails
      api.useAuth(async () => null);

      const healthResponse = await api.handler(createRequest({ path: "/health" }));
      expect(healthResponse.status).toBe(200);
      expect(healthResponse.body).toEqual({ status: "ok" });

      const secretResponse = await api.handler(createRequest({ path: "/secret" }));
      expect(secretResponse.status).toBe(401);
    });
  });

  describe("combined role + scope guards", () => {
    it("enforces both role and scope requirements", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminMetrics: query
            .requireRole("admin")
            .requireScope("read:metrics")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/admin-metrics", api.queries.adminMetrics);

      // Has role but not scope
      api.useAuth(alwaysAuth({ userId: "u1", roles: ["admin"], scopes: [] }));
      const response = await api.handler(createRequest({ path: "/admin-metrics" }));
      expect(response.status).toBe(403);
    });

    it("passes when both role and scope are satisfied", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminMetrics: query
            .requireRole("admin")
            .requireScope("read:metrics")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/admin-metrics", api.queries.adminMetrics);
      api.useAuth(
        alwaysAuth({
          userId: "u1",
          roles: ["admin"],
          scopes: ["read:metrics"],
        }),
      );

      const response = await api.handler(createRequest({ path: "/admin-metrics" }));
      expect(response.status).toBe(200);
    });
  });

  describe("onAuthorizationFailure hook", () => {
    it("fires when role check fails", async () => {
      const onAuthorizationFailure = vi.fn();
      const { define, query } = initServe({
        context: () => ({}),
        hooks: { onAuthorizationFailure },
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole("admin").query(async () => ({ ok: true })),
        },
      });

      api.route("/admin", api.queries.adminOnly);
      api.useAuth(alwaysAuth({ userId: "u1", roles: ["viewer"] }));

      await api.handler(createRequest({ path: "/admin" }));
      expect(onAuthorizationFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "MISSING_ROLE",
          required: ["admin"],
          actual: ["viewer"],
        }),
      );
    });

    it("fires when scope check fails", async () => {
      const onAuthorizationFailure = vi.fn();
      const { define, query } = initServe({
        context: () => ({}),
        hooks: { onAuthorizationFailure },
      });

      const api = define({
        queries: {
          metrics: query
            .requireScope("read:metrics")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/metrics", api.queries.metrics);
      api.useAuth(alwaysAuth({ userId: "u1", scopes: [] }));

      await api.handler(createRequest({ path: "/metrics" }));
      expect(onAuthorizationFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: "MISSING_SCOPE",
          required: ["read:metrics"],
          actual: [],
        }),
      );
    });
  });

  describe("middleware helpers", () => {
    describe("requireAuthMiddleware", () => {
      it("throws for unauthenticated context", async () => {
        const middleware = requireAuthMiddleware();
        const ctx = { auth: null } as any;
        const next = vi.fn();

        await expect(middleware(ctx, next)).rejects.toThrow("Authentication required");
        expect(next).not.toHaveBeenCalled();
      });

      it("passes for authenticated context", async () => {
        const middleware = requireAuthMiddleware();
        const ctx = { auth: { userId: "u1" } } as any;
        const next = vi.fn().mockResolvedValue("result");

        const result = await middleware(ctx, next);
        expect(next).toHaveBeenCalled();
        expect(result).toBe("result");
      });
    });

    describe("requireRoleMiddleware", () => {
      it("throws for missing role", async () => {
        const middleware = requireRoleMiddleware("admin");
        const ctx = { auth: { roles: ["viewer"] } } as any;
        const next = vi.fn();

        await expect(middleware(ctx, next)).rejects.toThrow(
          "Missing required role",
        );
        expect(next).not.toHaveBeenCalled();
      });

      it("passes for matching role", async () => {
        const middleware = requireRoleMiddleware("admin");
        const ctx = { auth: { roles: ["admin"] } } as any;
        const next = vi.fn().mockResolvedValue("ok");

        const result = await middleware(ctx, next);
        expect(next).toHaveBeenCalled();
        expect(result).toBe("ok");
      });
    });

    describe("requireScopeMiddleware", () => {
      it("throws for missing scope", async () => {
        const middleware = requireScopeMiddleware("read:metrics", "write:metrics");
        const ctx = { auth: { scopes: ["read:metrics"] } } as any;
        const next = vi.fn();

        await expect(middleware(ctx, next)).rejects.toThrow(
          "Missing required scopes: write:metrics",
        );
        expect(next).not.toHaveBeenCalled();
      });

      it("passes when all scopes present", async () => {
        const middleware = requireScopeMiddleware("read:metrics", "write:metrics");
        const ctx = {
          auth: { scopes: ["read:metrics", "write:metrics"] },
        } as any;
        const next = vi.fn().mockResolvedValue("ok");

        const result = await middleware(ctx, next);
        expect(next).toHaveBeenCalled();
        expect(result).toBe("ok");
      });
    });
  });

  describe("endpoint metadata", () => {
    it("includes requiredRoles and requiredScopes in metadata", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminMetrics: query
            .requireRole("admin", "super-admin")
            .requireScope("read:metrics")
            .query(async () => ({ data: [] })),
        },
      });

      api.route("/admin-metrics", api.queries.adminMetrics);

      const description = api.describe();
      const endpoint = description.queries.find((q) => q.key === "adminMetrics");
      expect(endpoint?.requiresAuth).toBe(true);
    });

    it("marks .public() endpoints as not requiring auth", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          health: query.public().query(async () => ({ ok: true })),
        },
      });

      api.route("/health", api.queries.health);

      const description = api.describe();
      const endpoint = description.queries.find((q) => q.key === "health");
      expect(endpoint?.requiresAuth).toBe(false);
    });
  });
});
