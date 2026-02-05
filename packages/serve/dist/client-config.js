/**
 * Extract serializable client configuration from a ServeBuilder.
 * This generates a runtime object that can be used client-side to configure
 * HTTP methods and paths for each query.
 *
 * Prioritizes route-level method configuration over endpoint defaults.
 *
 * @example
 * // Server-side (e.g., in api/config/route.ts)
 * import { api } from '@/analytics/queries';
 * import { extractClientConfig } from '@hypequery/serve';
 *
 * export async function GET() {
 *   return Response.json(extractClientConfig(api));
 * }
 *
 * // Client-side
 * const config = await fetch('/api/config').then(r => r.json());
 * createHooks<Api>({ baseUrl: '/api/hypequery', config });
 */
export function extractClientConfig(api) {
    const config = {};
    // Prefer route-level config if available
    if (api._routeConfig) {
        for (const [key, routeConfig] of Object.entries(api._routeConfig)) {
            config[key] = {
                method: routeConfig.method,
            };
        }
    }
    else {
        // Fallback to endpoint method
        for (const [key, endpoint] of Object.entries(api.queries)) {
            config[key] = {
                method: endpoint.method,
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
 *   hello: { method: 'GET' },
 *   createUser: { method: 'POST' },
 * });
 */
export function defineClientConfig(config) {
    return config;
}
