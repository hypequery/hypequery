import { mergeTags } from "../utils.js";
import { normalizeRoutePath } from "../router.js";
import { mapEndpointToToolkit } from "./mapper.js";
export const createBuilderMethods = (queryEntries, queryLogger, routeConfig, router, authStrategies, globalMiddlewares, executeQuery, handler, basePath) => {
    const builder = {
        queries: queryEntries,
        queryLogger,
        _routeConfig: routeConfig,
        route: (path, endpoint, options = {}) => {
            if (!endpoint) {
                throw new Error("Endpoint definition is required when registering a route");
            }
            const method = options?.method ?? endpoint.method;
            // Find the query key for this endpoint
            const queryKey = Object.entries(queryEntries).find(([_, e]) => e === endpoint)?.[0];
            if (queryKey) {
                routeConfig[queryKey] = { method };
            }
            const normalizedPath = normalizeRoutePath(path);
            const fallbackRequiresAuth = endpoint.auth
                ? true
                : authStrategies.length > 0
                    ? true
                    : undefined;
            const requiresAuth = options?.requiresAuth ?? endpoint.metadata.requiresAuth ?? fallbackRequiresAuth;
            const visibility = options?.visibility ?? endpoint.metadata.visibility ?? "public";
            const metadata = {
                ...endpoint.metadata,
                path: normalizedPath,
                method,
                name: options?.name ?? endpoint.metadata.name ?? endpoint.key,
                summary: options?.summary ?? endpoint.metadata.summary,
                description: options?.description ?? endpoint.metadata.description,
                tags: mergeTags(endpoint.metadata.tags, options?.tags),
                requiresAuth,
                visibility,
            };
            const middlewares = [...endpoint.middlewares, ...(options?.middlewares ?? [])];
            const registeredEndpoint = {
                ...endpoint,
                method,
                metadata,
                middlewares,
            };
            router.register(registeredEndpoint);
            return builder;
        },
        use: (middleware) => {
            globalMiddlewares.push(middleware);
            return builder;
        },
        useAuth: (strategy) => {
            authStrategies.push(strategy);
            router.markRoutesRequireAuth();
            return builder;
        },
        execute: executeQuery,
        run: executeQuery,
        describe: () => {
            const description = {
                basePath: basePath || undefined,
                queries: router.list().map(mapEndpointToToolkit),
            };
            return description;
        },
        handler,
        start: async (options = {}) => {
            const { startNodeServer } = require("../adapters/node.js");
            return startNodeServer(handler, options);
        },
    };
    return builder;
};
