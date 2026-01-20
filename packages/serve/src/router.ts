import type { EndpointRegistry, HttpMethod, ServeEndpoint } from "./types.js";

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, "");

export const normalizeRoutePath = (path: string) => {
  const trimmed = trimSlashes(path || "/");
  return `/${trimmed}`.replace(/\/+/g, "/").replace(/\/$/, trimmed ? "" : "/");
};

export const applyBasePath = (basePath: string, path: string) => {
  const parts = [trimSlashes(basePath ?? ""), trimSlashes(path)]
    .filter(Boolean)
    .join("/");
  const combined = parts ? `/${parts}` : "/";
  return combined.replace(/\/+/g, "/").replace(/\/$/, combined === "/" ? "/" : "");
};

export class ServeRouter implements EndpointRegistry {
  private routes: ServeEndpoint<any, any, any, any>[] = [];

  constructor(private readonly basePath = "") {}

  list() {
    return [...this.routes];
  }

  register(endpoint: ServeEndpoint<any, any, any, any>) {
    const path = endpoint.metadata.path || "/";
    const normalizedPath = applyBasePath(this.basePath, path);
    const method = endpoint.method;

    const existing = this.routes.find(
      (route) => route.metadata.path === normalizedPath && route.method === method
    );

    if (existing) {
      throw new Error(`Route already registered for ${method} ${normalizedPath}`);
    }

    this.routes.push({
      ...endpoint,
      metadata: {
        ...endpoint.metadata,
        path: normalizedPath,
        method,
      },
    });
  }

  match(method: HttpMethod, path: string) {
    const normalizedPath = normalizeRoutePath(path);
    return (
      this.routes.find(
        (route) => route.method === method && route.metadata.path === normalizedPath
      ) ?? null
    );
  }

  markRoutesRequireAuth() {
    this.routes = this.routes.map((route) => {
      if (route.metadata.requiresAuth === false) {
        return route;
      }

      return {
        ...route,
        metadata: {
          ...route.metadata,
          requiresAuth: true,
        },
      };
    });
  }
}
