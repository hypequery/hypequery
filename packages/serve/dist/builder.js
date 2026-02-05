import { mergeTags } from './utils.js';
const defaultState = () => ({
    tags: [],
    middlewares: [],
});
export const createProcedureBuilder = () => {
    const build = (state) => ({
        input: (schema) => build({ ...state, inputSchema: schema }),
        output: (schema) => build({ ...state, outputSchema: schema }),
        describe: (description) => build({ ...state, description }),
        name: (name) => build({ ...state, name }),
        summary: (summary) => build({ ...state, summary }),
        tag: (tag) => build({ ...state, tags: mergeTags(state.tags, [tag]) }),
        tags: (tags) => build({ ...state, tags: mergeTags(state.tags, tags) }),
        method: (method) => build({ ...state, method }),
        cache: (ttlMs) => build({ ...state, cacheTtlMs: ttlMs }),
        auth: (strategy) => build({ ...state, auth: strategy }),
        requireAuth: () => build({ ...state, requiresAuth: true }),
        requireRole: (...roles) => build({
            ...state,
            requiresAuth: true,
            requiredRoles: [...(state.requiredRoles ?? []), ...roles],
        }),
        requireScope: (...scopes) => build({
            ...state,
            requiresAuth: true,
            requiredScopes: [...(state.requiredScopes ?? []), ...scopes],
        }),
        public: () => build({ ...state, requiresAuth: false }),
        tenant: (config) => build({ ...state, tenant: config }),
        custom: (custom) => build({ ...state, custom: { ...(state.custom ?? {}), ...custom } }),
        use: (...middlewares) => build({ ...state, middlewares: [...state.middlewares, ...middlewares] }),
        query: (executable) => {
            const config = {
                description: state.description,
                name: state.name,
                summary: state.summary,
                tags: state.tags,
                method: state.method,
                inputSchema: state.inputSchema,
                outputSchema: state.outputSchema,
                cacheTtlMs: state.cacheTtlMs,
                auth: typeof state.auth === 'undefined' ? null : state.auth,
                requiresAuth: state.requiresAuth,
                tenant: state.tenant,
                requiredRoles: state.requiredRoles,
                requiredScopes: state.requiredScopes,
                custom: state.custom,
                middlewares: state.middlewares,
                query: executable,
            };
            return config;
        },
    });
    return build(defaultState());
};
