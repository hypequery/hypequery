import { z } from "zod";
const fallbackSchema = z.any();
const resolveQueryRunner = (query) => {
    if (!query) {
        return null;
    }
    const fn = typeof query === "function"
        ? query
        : typeof query === "object" && typeof query.run === "function"
            ? query.run.bind(query)
            : null;
    if (!fn) {
        return null;
    }
    return async (args) => {
        return fn(args);
    };
};
export const createEndpoint = (key, definition) => {
    const method = definition.method ?? "GET";
    const hasRolesOrScopes = (definition.requiredRoles?.length ?? 0) > 0
        || (definition.requiredScopes?.length ?? 0) > 0;
    const metadata = {
        path: "",
        method: method,
        name: definition.name ?? definition.summary ?? key,
        summary: definition.summary,
        description: definition.description,
        tags: definition.tags ?? [],
        requiresAuth: definition.requiresAuth ?? (definition.auth ? true : hasRolesOrScopes ? true : undefined),
        requiredRoles: definition.requiredRoles,
        requiredScopes: definition.requiredScopes,
        deprecated: undefined,
        visibility: "public",
        custom: definition.custom,
    };
    const runner = resolveQueryRunner(definition.query);
    const handler = async (ctx) => {
        if (!runner) {
            throw new Error(`Endpoint "${key}" is missing an executable query`);
        }
        return runner({
            input: ctx.input,
            ctx: ctx,
        });
    };
    const outputSchema = (definition.outputSchema ?? fallbackSchema);
    const inputSchema = definition.inputSchema;
    return {
        key,
        method,
        inputSchema,
        outputSchema,
        handler,
        query: definition.query,
        middlewares: definition.middlewares ?? [],
        auth: definition.auth ?? null,
        tenant: definition.tenant,
        metadata,
        cacheTtlMs: definition.cacheTtlMs ?? null,
        defaultHeaders: undefined,
        requiredRoles: definition.requiredRoles,
        requiredScopes: definition.requiredScopes,
    };
};
