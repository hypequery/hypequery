import { executeEndpoint } from "../pipeline.js";
export const createExecuteQuery = (queryEntries, authStrategies, contextFactory, globalMiddlewares, tenantConfig, hooks, queryLogger, verboseAuthErrors) => {
    return async (key, options) => {
        const endpoint = queryEntries[key];
        if (!endpoint) {
            throw new Error(`No query registered for key ${String(key)}`);
        }
        const request = {
            method: endpoint.method,
            path: options?.request?.path ?? endpoint.metadata.path ?? `/__execute/${String(key)}`,
            query: options?.request?.query ?? {},
            headers: options?.request?.headers ?? {},
            body: options?.input ?? options?.request?.body,
            raw: options?.request?.raw,
        };
        const response = await executeEndpoint({
            endpoint,
            request,
            authStrategies,
            contextFactory,
            globalMiddlewares,
            tenantConfig,
            hooks,
            queryLogger,
            additionalContext: options?.context,
            verboseAuthErrors,
        });
        if (response.status !== 200) {
            const errorBody = response.body;
            const error = new Error(errorBody.error.message);
            error.type = errorBody.error.type;
            if (errorBody.error.details) {
                error.details = errorBody.error.details;
            }
            throw error;
        }
        return response.body;
    };
};
