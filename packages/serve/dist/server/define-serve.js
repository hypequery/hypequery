import { createEndpoint } from "../endpoint.js";
import { ServeRouter, applyBasePath } from "../router.js";
import { ensureArray } from "../utils.js";
import { ServeQueryLogger, formatQueryEvent, formatQueryEventJSON } from "../query-logger.js";
import { createServeHandler } from "../pipeline.js";
import { createDocsEndpoint, createOpenApiEndpoint } from "../pipeline.js";
import { createExecuteQuery } from "./execute-query.js";
import { createBuilderMethods } from "./builder.js";
export const defineServe = (config) => {
    const basePath = config.basePath ?? "/api/analytics";
    const router = new ServeRouter(basePath);
    const globalMiddlewares = [
        ...(config.middlewares ?? []),
    ];
    const authStrategies = ensureArray(config.auth);
    const globalTenantConfig = config.tenant;
    const contextFactory = config.context;
    const hooks = (config.hooks ?? {});
    const queryLogger = new ServeQueryLogger();
    // Wire up production query logging if configured
    if (config.queryLogging) {
        if (typeof config.queryLogging === 'function') {
            queryLogger.on(config.queryLogging);
        }
        else if (config.queryLogging === 'json') {
            queryLogger.on((event) => {
                const line = formatQueryEventJSON(event);
                if (line)
                    console.log(line);
            });
        }
        else {
            queryLogger.on((event) => {
                const line = formatQueryEvent(event);
                if (line)
                    console.log(line);
            });
        }
    }
    // Slow query warning
    if (config.slowQueryThreshold != null) {
        queryLogger.on((event) => {
            if (event.status === 'completed' && event.durationMs && event.durationMs > config.slowQueryThreshold) {
                console.warn(`[hypequery/slow-query] ${event.method} ${event.path} took ${event.durationMs}ms (threshold: ${config.slowQueryThreshold}ms)`);
            }
        });
    }
    const openapiConfig = {
        enabled: config.openapi?.enabled ?? true,
        path: config.openapi?.path ?? "/openapi.json",
    };
    const docsConfig = {
        enabled: config.docs?.enabled ?? true,
        path: config.docs?.path ?? "/docs",
    };
    const openapiPublicPath = applyBasePath(basePath, openapiConfig.path);
    const configuredQueries = config.queries ?? {};
    const queryEntries = {};
    const registerQuery = (key, definition) => {
        queryEntries[key] = createEndpoint(String(key), definition);
    };
    for (const key of Object.keys(configuredQueries)) {
        registerQuery(key, configuredQueries[key]);
    }
    const handler = createServeHandler({
        router,
        globalMiddlewares,
        authStrategies,
        tenantConfig: globalTenantConfig,
        contextFactory,
        hooks,
        queryLogger,
        verboseAuthErrors: config.security?.verboseAuthErrors ?? false,
    });
    // Track route configuration for client config extraction
    const routeConfig = {};
    const executeQuery = createExecuteQuery(queryEntries, authStrategies, contextFactory, globalMiddlewares, globalTenantConfig, hooks, queryLogger, config.security?.verboseAuthErrors ?? false);
    const builder = createBuilderMethods(queryEntries, queryLogger, routeConfig, router, authStrategies, globalMiddlewares, executeQuery, handler, basePath);
    if (openapiConfig.enabled) {
        const openapiEndpoint = createOpenApiEndpoint(openapiConfig.path, () => router.list(), config.openapi);
        router.register(openapiEndpoint);
    }
    if (docsConfig.enabled) {
        const docsEndpoint = createDocsEndpoint(docsConfig.path, openapiPublicPath, config.docs);
        router.register(docsEndpoint);
    }
    return builder;
};
