import { describe, it, expect, beforeEach } from "vitest";
import { normalizeRoutePath, applyBasePath, ServeRouter } from "./router.js";
import type { ServeEndpoint } from "./types.js";

describe("Router Utilities", () => {
  describe("normalizeRoutePath", () => {
    describe("Slash normalization", () => {
      it("ensures path starts with /", () => {
        expect(normalizeRoutePath("api/users")).toBe("/api/users");
        expect(normalizeRoutePath("users")).toBe("/users");
      });

      it("removes trailing slashes except for root", () => {
        expect(normalizeRoutePath("/api/users/")).toBe("/api/users");
        expect(normalizeRoutePath("/users/")).toBe("/users");
        expect(normalizeRoutePath("api/")).toBe("/api");
      });

      it("removes leading slashes but adds single slash", () => {
        expect(normalizeRoutePath("///api/users")).toBe("/api/users");
        expect(normalizeRoutePath("//users")).toBe("/users");
      });

      it("removes duplicate slashes in path", () => {
        expect(normalizeRoutePath("/api//users")).toBe("/api/users");
        expect(normalizeRoutePath("/api///users///posts")).toBe("/api/users/posts");
        expect(normalizeRoutePath("//api////users//")).toBe("/api/users");
      });
    });

    describe("Root path handling", () => {
      it("handles root path /", () => {
        expect(normalizeRoutePath("/")).toBe("/");
      });

      it("handles empty string as root", () => {
        expect(normalizeRoutePath("")).toBe("/");
      });

      it("handles multiple slashes as root", () => {
        expect(normalizeRoutePath("///")).toBe("/");
        expect(normalizeRoutePath("//")).toBe("/");
      });
    });

    describe("Edge cases", () => {
      it("handles single segment path", () => {
        expect(normalizeRoutePath("api")).toBe("/api");
        expect(normalizeRoutePath("/api")).toBe("/api");
        expect(normalizeRoutePath("/api/")).toBe("/api");
      });

      it("handles deeply nested paths", () => {
        expect(normalizeRoutePath("/api/v1/users/123/posts/456")).toBe(
          "/api/v1/users/123/posts/456"
        );
      });

      it("handles paths with special characters", () => {
        expect(normalizeRoutePath("/api/users-list")).toBe("/api/users-list");
        expect(normalizeRoutePath("/api/users_list")).toBe("/api/users_list");
        expect(normalizeRoutePath("/api/users.json")).toBe("/api/users.json");
      });
    });
  });

  describe("applyBasePath", () => {
    describe("Combining base and path", () => {
      it("combines base path and path", () => {
        expect(applyBasePath("/api", "/users")).toBe("/api/users");
        expect(applyBasePath("/api/v1", "/users")).toBe("/api/v1/users");
      });

      it("handles paths without leading slashes", () => {
        expect(applyBasePath("/api", "users")).toBe("/api/users");
        expect(applyBasePath("api", "users")).toBe("/api/users");
      });

      it("handles base paths without leading slashes", () => {
        expect(applyBasePath("api", "/users")).toBe("/api/users");
        expect(applyBasePath("api/v1", "users")).toBe("/api/v1/users");
      });

      it("removes trailing slashes from result", () => {
        expect(applyBasePath("/api/", "/users/")).toBe("/api/users");
        expect(applyBasePath("/api", "/users/")).toBe("/api/users");
      });
    });

    describe("Empty paths", () => {
      it("handles empty base path", () => {
        expect(applyBasePath("", "/users")).toBe("/users");
        expect(applyBasePath("", "users")).toBe("/users");
      });

      it("handles empty path", () => {
        expect(applyBasePath("/api", "")).toBe("/api");
        expect(applyBasePath("/api", "/")).toBe("/api");
      });

      it("handles both empty returns root", () => {
        expect(applyBasePath("", "")).toBe("/");
        expect(applyBasePath("", "/")).toBe("/");
        expect(applyBasePath("/", "")).toBe("/");
      });
    });

    describe("Normalization", () => {
      it("removes duplicate slashes", () => {
        expect(applyBasePath("//api//", "//users//")).toBe("/api/users");
        expect(applyBasePath("/api/", "/users")).toBe("/api/users");
      });

      it("normalizes root path result", () => {
        expect(applyBasePath("/", "/")).toBe("/");
        expect(applyBasePath("", "")).toBe("/");
      });

      it("handles multiple path segments", () => {
        expect(applyBasePath("/api/v1", "/users/123")).toBe("/api/v1/users/123");
        expect(applyBasePath("/api", "/v1/users/123")).toBe("/api/v1/users/123");
      });
    });
  });

  describe("ServeRouter", () => {
    let router: ServeRouter;

    // Helper to create mock endpoint
    const createEndpoint = (
      method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
      path: string,
      requiresAuth?: boolean
    ): ServeEndpoint<any, any, any, any> => ({
      method,
      handler: async () => ({ data: "test" }),
      metadata: {
        path,
        method,
        ...(requiresAuth !== undefined && { requiresAuth }),
      },
    });

    beforeEach(() => {
      router = new ServeRouter();
    });

    describe("Registration", () => {
      it("registers a route", () => {
        const endpoint = createEndpoint("GET", "/users");
        router.register(endpoint);

        const routes = router.list();
        expect(routes).toHaveLength(1);
        expect(routes[0].method).toBe("GET");
        expect(routes[0].metadata.path).toBe("/users");
      });

      it("registers multiple routes", () => {
        router.register(createEndpoint("GET", "/users"));
        router.register(createEndpoint("POST", "/users"));
        router.register(createEndpoint("GET", "/posts"));

        const routes = router.list();
        expect(routes).toHaveLength(3);
      });

      it("normalizes paths during registration", () => {
        router.register(createEndpoint("GET", "users/"));
        router.register(createEndpoint("POST", "//posts"));

        const routes = router.list();
        expect(routes[0].metadata.path).toBe("/users");
        expect(routes[1].metadata.path).toBe("/posts");
      });

      it("handles root path registration", () => {
        router.register(createEndpoint("GET", "/"));

        const routes = router.list();
        expect(routes[0].metadata.path).toBe("/");
      });

      it("handles empty path as root", () => {
        router.register(createEndpoint("GET", ""));

        const routes = router.list();
        expect(routes[0].metadata.path).toBe("/");
      });
    });

    describe("Duplicate prevention", () => {
      it("prevents duplicate route registration for same method and path", () => {
        router.register(createEndpoint("GET", "/users"));

        expect(() => {
          router.register(createEndpoint("GET", "/users"));
        }).toThrow("Route already registered for GET /users");
      });

      it("allows same path with different methods", () => {
        router.register(createEndpoint("GET", "/users"));
        router.register(createEndpoint("POST", "/users"));

        const routes = router.list();
        expect(routes).toHaveLength(2);
      });

      it("allows different paths with same method", () => {
        router.register(createEndpoint("GET", "/users"));
        router.register(createEndpoint("GET", "/posts"));

        const routes = router.list();
        expect(routes).toHaveLength(2);
      });

      it("throws error with correct method and path in message", () => {
        router.register(createEndpoint("POST", "/api/users"));

        expect(() => {
          router.register(createEndpoint("POST", "/api/users"));
        }).toThrow("POST /api/users");
      });
    });

    describe("Base path application", () => {
      it("applies base path to registered routes", () => {
        const routerWithBase = new ServeRouter("/api");
        routerWithBase.register(createEndpoint("GET", "/users"));

        const routes = routerWithBase.list();
        expect(routes[0].metadata.path).toBe("/api/users");
      });

      it("applies base path with multiple segments", () => {
        const routerWithBase = new ServeRouter("/api/v1");
        routerWithBase.register(createEndpoint("GET", "/users"));

        const routes = routerWithBase.list();
        expect(routes[0].metadata.path).toBe("/api/v1/users");
      });

      it("normalizes base path and route path", () => {
        const routerWithBase = new ServeRouter("//api//");
        routerWithBase.register(createEndpoint("GET", "//users//"));

        const routes = routerWithBase.list();
        expect(routes[0].metadata.path).toBe("/api/users");
      });

      it("handles empty base path", () => {
        const routerWithBase = new ServeRouter("");
        routerWithBase.register(createEndpoint("GET", "/users"));

        const routes = routerWithBase.list();
        expect(routes[0].metadata.path).toBe("/users");
      });
    });

    describe("Matching", () => {
      beforeEach(() => {
        router.register(createEndpoint("GET", "/users"));
        router.register(createEndpoint("POST", "/users"));
        router.register(createEndpoint("GET", "/posts"));
      });

      it("matches route by method and path", () => {
        const match = router.match("GET", "/users");
        expect(match).not.toBeNull();
        expect(match?.method).toBe("GET");
        expect(match?.metadata.path).toBe("/users");
      });

      it("returns null for non-existent route", () => {
        const match = router.match("GET", "/non-existent");
        expect(match).toBeNull();
      });

      it("returns null for wrong method", () => {
        const match = router.match("DELETE", "/users");
        expect(match).toBeNull();
      });

      it("matches correct route when multiple exist for same path", () => {
        const getMatch = router.match("GET", "/users");
        const postMatch = router.match("POST", "/users");

        expect(getMatch?.method).toBe("GET");
        expect(postMatch?.method).toBe("POST");
      });

      it("normalizes path when matching", () => {
        const match = router.match("GET", "users/");
        expect(match).not.toBeNull();
        expect(match?.metadata.path).toBe("/users");
      });

      it("matches root path", () => {
        router.register(createEndpoint("GET", "/"));
        const match = router.match("GET", "/");
        expect(match).not.toBeNull();
        expect(match?.metadata.path).toBe("/");
      });

      it("handles path normalization in matching", () => {
        const match = router.match("GET", "//users//");
        expect(match).not.toBeNull();
      });
    });

    describe("markRoutesRequireAuth", () => {
      it("marks all routes as requiring auth", () => {
        router.register(createEndpoint("GET", "/users"));
        router.register(createEndpoint("POST", "/posts"));

        router.markRoutesRequireAuth();

        const routes = router.list();
        expect(routes[0].metadata.requiresAuth).toBe(true);
        expect(routes[1].metadata.requiresAuth).toBe(true);
      });

      it("does not override routes explicitly set to requiresAuth: false", () => {
        router.register(createEndpoint("GET", "/public", false));
        router.register(createEndpoint("GET", "/users"));

        router.markRoutesRequireAuth();

        const routes = router.list();
        const publicRoute = routes.find((r) => r.metadata.path === "/public");
        const usersRoute = routes.find((r) => r.metadata.path === "/users");

        expect(publicRoute?.metadata.requiresAuth).toBe(false);
        expect(usersRoute?.metadata.requiresAuth).toBe(true);
      });

      it("marks routes that were undefined as true", () => {
        router.register(createEndpoint("GET", "/users"));

        const routesBefore = router.list();
        expect(routesBefore[0].metadata.requiresAuth).toBeUndefined();

        router.markRoutesRequireAuth();

        const routesAfter = router.list();
        expect(routesAfter[0].metadata.requiresAuth).toBe(true);
      });

      it("preserves routes explicitly set to requiresAuth: true", () => {
        router.register(createEndpoint("GET", "/admin", true));

        router.markRoutesRequireAuth();

        const routes = router.list();
        expect(routes[0].metadata.requiresAuth).toBe(true);
      });

      it("handles mixed requiresAuth settings", () => {
        router.register(createEndpoint("GET", "/public", false));
        router.register(createEndpoint("POST", "/users", true));
        router.register(createEndpoint("GET", "/posts"));

        router.markRoutesRequireAuth();

        const routes = router.list();
        expect(routes[0].metadata.requiresAuth).toBe(false); // /public
        expect(routes[1].metadata.requiresAuth).toBe(true); // /users
        expect(routes[2].metadata.requiresAuth).toBe(true); // /posts
      });
    });

    describe("list", () => {
      it("returns a copy of routes array", () => {
        router.register(createEndpoint("GET", "/users"));

        const routes1 = router.list();
        const routes2 = router.list();

        expect(routes1).toEqual(routes2);
        expect(routes1).not.toBe(routes2); // Different array instances
      });

      it("returns empty array when no routes", () => {
        const routes = router.list();
        expect(routes).toEqual([]);
      });

      it("modifications to returned array don't affect router", () => {
        router.register(createEndpoint("GET", "/users"));

        const routes = router.list();
        routes.push(createEndpoint("POST", "/posts"));

        const actualRoutes = router.list();
        expect(actualRoutes).toHaveLength(1); // Only the GET /users
      });
    });
  });
});
