import type { ServeBuilder, HttpMethod, AuthContext } from "./types.js";

/**
 * Configuration for a single query's client-side behavior
 */
export interface QueryClientConfig {
  method: HttpMethod;
  path?: string;
}

/**
 * Map of query names to their client configurations
 */
export type ApiClientConfig = Record<string, QueryClientConfig>;

/**
 * Extract serializable client configuration from a ServeBuilder.
 * This generates a runtime object that can be used client-side to configure
 * the HTTP method and full request path of each query, metric and dataset.
 *
 * @deprecated Use `api.manifest()`, which returns the same routes and is what
 * `@hypequery/react` accepts as `manifest`. Retained for compatibility; it
 * delegates to `api.manifest()`.
 *
 * @example
 * // Server-side (e.g., in app/api/hypequery-manifest/route.ts)
 * import { api } from '@/analytics/queries';
 *
 * export async function GET() {
 *   return Response.json(api.manifest());
 * }
 *
 * // Client-side
 * const manifest = await fetch('/api/hypequery-manifest').then(r => r.json());
 * createHypequeryClient<Api>({ baseUrl: '/api/analytics', manifest });
 */
export function extractClientConfig<
  TQueries extends Record<string, any>,
  TContext extends Record<string, unknown>,
  TAuth extends AuthContext
>(api: ServeBuilder<TQueries, TContext, TAuth>): ApiClientConfig {
  const config: ApiClientConfig = {};

  // The manifest carries each route's full path: the base path plus any
  // `api.route(...)` override. Endpoint metadata alone has neither.
  if (typeof api.manifest === "function") {
    for (const [key, route] of Object.entries(api.manifest())) {
      config[key] = { method: route.method, path: route.path };
    }
    return config;
  }

  // Prefer route-level config if available
  if (api._routeConfig) {
    for (const [key, routeConfig] of Object.entries(api._routeConfig)) {
      config[key] = {
        method: routeConfig.method,
        path: api.queries[key as keyof typeof api.queries]?.metadata?.path,
      };
    }
  } else {
    // Fallback to endpoint method
    for (const [key, endpoint] of Object.entries(api.queries)) {
      config[key] = {
        method: endpoint.method,
        path: endpoint.metadata?.path,
      };
    }
  }

  return config;
}

/**
 * Type-safe helper to manually define client configuration.
 * Use this when you can't access the api object client-side.
 *
 * @example
 * const config = defineClientConfig({
 *   hello: { method: 'GET', path: '/api/analytics/queries/hello' },
 *   createUser: { method: 'POST', path: '/api/analytics/queries/createUser' },
 * });
 */
export function defineClientConfig<T extends ApiClientConfig>(config: T): T {
  return config;
}
