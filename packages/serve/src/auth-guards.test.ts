import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineServe, initServe } from "./server";
import {
  createAuthSystem,
  checkRoleAuthorization,
  checkScopeAuthorization,
} from "./auth";
import type {
  AuthContext,
  AuthContextWithRoles,
  AuthContextWithScopes,
  ServeRequest,
} from "./types";

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

    it("includes requiredRoles and requiredScopes in endpoint metadata", async () => {
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
      expect(endpoint?.requiredRoles).toEqual(["admin", "super-admin"]);
      expect(endpoint?.requiredScopes).toEqual(["read:metrics"]);
    });
  });

  describe("OpenAPI integration", () => {
    it("includes auth guard requirements in OpenAPI description", async () => {
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

      // Make request to OpenAPI endpoint
      const response = await api.handler(createRequest({ path: "/openapi.json" }));

      expect(response.status).toBe(200);
      const openapi = response.body as any;
      const operation = openapi.paths["/api/analytics/admin-metrics"]?.get;

      expect(operation?.security).toEqual([{ ApiKeyAuth: [] }]);
      expect(operation?.description).toContain("**Required roles:** admin");
      expect(operation?.description).toContain("**Required scopes:** read:metrics");
    });

    it("excludes security from .public() endpoints in OpenAPI", async () => {
      const { define, query } = initServe({
        context: () => ({}),
      });

      const api = define({
        queries: {
          health: query.public().query(async () => ({ status: "ok" })),
        },
      });

      api.route("/health", api.queries.health);

      // Make request to OpenAPI endpoint
      const response = await api.handler(createRequest({ path: "/openapi.json" }));

      expect(response.status).toBe(200);
      const openapi = response.body as any;
      const operation = openapi.paths["/api/analytics/health"]?.get;

      expect(operation?.security).toBeUndefined();
      expect(openapi.components?.securitySchemes).toBeUndefined();
    });
  });

  describe("Typed Auth System", () => {
    it("creates a typed auth system with roles and scopes", () => {
      const { useAuth, TypedAuth } = createAuthSystem({
        roles: ['admin', 'editor', 'viewer'] as const,
        scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] as const,
      });

      expect(useAuth).toBeDefined();
      expect(typeof useAuth).toBe('function');
      expect(TypedAuth).toBeDefined();
    });

    it("creates typed auth without roles or scopes", () => {
      const { useAuth, TypedAuth } = createAuthSystem();

      expect(useAuth).toBeDefined();
      expect(TypedAuth).toBeDefined();
    });

    it("useAuth wrapper returns the auth strategy unchanged", () => {
      const strategy = async () => ({ userId: 'test' });
      const { useAuth } = createAuthSystem({
        roles: ['admin'] as const,
      });

      const wrapped = useAuth(strategy);
      expect(wrapped).toBe(strategy);
    });

    it("works with typed auth context and requireRole", async () => {
      type AppRole = 'admin' | 'editor' | 'viewer';
      type AppAuth = AuthContextWithRoles<AppRole>;

      const { define, query } = initServe<AppAuth>({
        context: () => ({}),
      });

      const api = define({
        queries: {
          adminOnly: query.requireRole('admin').query(async () => ({ ok: true })),
        },
      });

      api.route('/admin', api.queries.adminOnly);

      // Test that valid role works
      const response1 = await api.handler(createRequest({
        path: '/admin',
        headers: {},
      }));

      expect(response1.status).toBe(401); // No auth provided

      // Test with auth
      const authStrategy = async () =>
        ({ userId: 'user1', roles: ['editor'] } as AppAuth);

      api.useAuth(authStrategy);

      const response2 = await api.handler(createRequest({
        path: '/admin',
        headers: {},
      }));

      expect(response2.status).toBe(403); // Has 'editor' role, not 'admin'
    });

    it("works with typed auth context and requireScope", async () => {
      type AppScope = 'read:metrics' | 'write:metrics' | 'delete:metrics';
      type AppAuth = AuthContextWithScopes<AppScope>;

      const { define, query } = initServe<AppAuth>({
        context: () => ({}),
      });

      const api = define({
        queries: {
          writeData: query.requireScope('write:metrics').query(async () => ({ ok: true })),
        },
      });

      api.route('/write', api.queries.writeData);

      // Test with auth that has scopes
      const authStrategy = async () =>
        ({ userId: 'user1', scopes: ['read:metrics'] } as AppAuth);

      api.useAuth(authStrategy);

      const response = await api.handler(createRequest({
        path: '/write',
        headers: {},
      }));

      expect(response.status).toBe(403); // Has 'read:metrics', not 'write:metrics'
    });

    it("combines roles and scopes with createAuthSystem", () => {
      type AppRole = 'admin' | 'editor' | 'viewer';
      type AppScope = 'read:metrics' | 'write:metrics' | 'delete:metrics';

      const { TypedAuth } = createAuthSystem({
        roles: ['admin', 'editor', 'viewer'] as const,
        scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] as const,
      });

      // Extract the combined type
      type AppAuth = typeof TypedAuth;

      // This should work - the type combines both constraints
      const authContext: AppAuth = {
        userId: 'test',
        roles: ['admin'], // ✅ Valid role
        scopes: ['read:metrics'], // ✅ Valid scope
      };

      expect(authContext.roles).toEqual(['admin']);
      expect(authContext.scopes).toEqual(['read:metrics']);
    });

    it("AuthContextWithRoles constrains role values", () => {
      type AppRole = 'admin' | 'editor';

      type AppAuth = AuthContextWithRoles<AppRole>;

      const validAuth: AppAuth = {
        userId: 'user1',
        roles: ['admin', 'editor'], // ✅ Valid
      };

      expect(validAuth.roles).toEqual(['admin', 'editor']);
    });

    it("AuthContextWithScopes constrains scope values", () => {
      type AppScope = 'read:metrics' | 'write:metrics';

      type AppAuth = AuthContextWithScopes<AppScope>;

      const validAuth: AppAuth = {
        userId: 'user1',
        scopes: ['read:metrics', 'write:metrics'], // ✅ Valid
      };

      expect(validAuth.scopes).toEqual(['read:metrics', 'write:metrics']);
    });
  });

  describe("Shared authorization validators", () => {
    describe("checkRoleAuthorization", () => {
      it("returns ok: true when no roles required", () => {
        const result = checkRoleAuthorization({ userId: 'user1' }, []);
        expect(result).toEqual({ ok: true });
      });

      it("returns ok: true when user has one of required roles (OR semantics)", () => {
        const auth = { userId: 'user1', roles: ['editor', 'viewer'] };
        const result = checkRoleAuthorization(auth, ['admin', 'editor']);
        expect(result).toEqual({ ok: true });
      });

      it("returns ok: false with ALL required roles in missing (not just missing ones)", () => {
        const auth = { userId: 'user1', roles: ['viewer'] };
        const result = checkRoleAuthorization(auth, ['admin', 'editor']);
        // Note: missing contains ALL required roles, not just the ones user lacks
        expect(result).toEqual({
          ok: false,
          missing: ['admin', 'editor'],
          reason: 'MISSING_ROLE',
        });
      });

      it("returns ok: false when user has empty roles array", () => {
        const auth = { userId: 'user1', roles: [] };
        const result = checkRoleAuthorization(auth, ['admin']);
        expect(result).toEqual({
          ok: false,
          missing: ['admin'],
          reason: 'MISSING_ROLE',
        });
      });

      it("returns ok: false when user has no roles property", () => {
        const auth = { userId: 'user1' };
        const result = checkRoleAuthorization(auth, ['admin']);
        expect(result).toEqual({
          ok: false,
          missing: ['admin'],
          reason: 'MISSING_ROLE',
        });
      });

      it("returns ok: false when auth is null", () => {
        const result = checkRoleAuthorization(null, ['admin']);
        expect(result).toEqual({
          ok: false,
          missing: ['admin'],
          reason: 'MISSING_ROLE',
        });
      });
    });

    describe("checkScopeAuthorization", () => {
      it("returns ok: true when no scopes required", () => {
        const result = checkScopeAuthorization({ userId: 'user1' }, []);
        expect(result).toEqual({ ok: true });
      });

      it("returns ok: true when user has all required scopes (AND semantics)", () => {
        const auth = { userId: 'user1', scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] };
        const result = checkScopeAuthorization(auth, ['read:metrics', 'write:metrics']);
        expect(result).toEqual({ ok: true });
      });

      it("returns ok: false with ALL required scopes in missing (not just missing ones)", () => {
        const auth = { userId: 'user1', scopes: ['read:metrics'] };
        const result = checkScopeAuthorization(auth, ['read:metrics', 'write:metrics']);
        // Note: missing contains ALL required scopes, not just the ones user lacks
        expect(result).toEqual({
          ok: false,
          missing: ['read:metrics', 'write:metrics'],
          reason: 'MISSING_SCOPE',
        });
      });

      it("returns ok: false when user has empty scopes array", () => {
        const auth = { userId: 'user1', scopes: [] };
        const result = checkScopeAuthorization(auth, ['read:metrics']);
        expect(result).toEqual({
          ok: false,
          missing: ['read:metrics'],
          reason: 'MISSING_SCOPE',
        });
      });

      it("returns ok: false when user has no scopes property", () => {
        const auth = { userId: 'user1' };
        const result = checkScopeAuthorization(auth, ['read:metrics']);
        expect(result).toEqual({
          ok: false,
          missing: ['read:metrics'],
          reason: 'MISSING_SCOPE',
        });
      });

      it("returns ok: false when auth is null", () => {
        const result = checkScopeAuthorization(null, ['read:metrics']);
        expect(result).toEqual({
          ok: false,
          missing: ['read:metrics'],
          reason: 'MISSING_SCOPE',
        });
      });
    });
  });
});
