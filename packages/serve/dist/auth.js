export const createApiKeyStrategy = (options) => {
    const headerName = options.header ?? "authorization";
    const queryParam = options.queryParam;
    return async ({ request }) => {
        let key;
        if (queryParam && typeof request.query[queryParam] === "string") {
            key = request.query[queryParam];
        }
        if (!key) {
            const headerValue = request.headers[headerName] ?? request.headers[headerName.toLowerCase()];
            if (typeof headerValue === "string") {
                key = headerValue.startsWith("Bearer ")
                    ? headerValue.slice("Bearer ".length)
                    : headerValue;
            }
        }
        if (!key) {
            return null;
        }
        return options.validate(key, request);
    };
};
export const createBearerTokenStrategy = (options) => {
    const headerName = options.header ?? "authorization";
    const prefix = options.prefix ?? "Bearer ";
    return async ({ request }) => {
        const raw = request.headers[headerName] ?? request.headers[headerName.toLowerCase()];
        if (typeof raw !== "string" || !raw.startsWith(prefix)) {
            return null;
        }
        const token = raw.slice(prefix.length).trim();
        if (!token) {
            return null;
        }
        return options.validate(token, request);
    };
};
/**
 * Check if the authenticated user has at least one of the required roles (OR semantics).
 *
 * @param auth - The auth context from the request
 * @param requiredRoles - Array of role names, any one of which grants access
 * @returns { ok: true } if user has a role, or { ok: false, missing, reason } with details
 *
 * @example
 * ```ts
 * const result = checkRoleAuthorization(auth, ['admin', 'editor']);
 * if (!result.ok) {
 *   console.log('Missing roles:', result.missing); // ['admin', 'editor'] (all required)
 * }
 * ```
 */
export const checkRoleAuthorization = (auth, requiredRoles) => {
    if (!requiredRoles || requiredRoles.length === 0) {
        return { ok: true };
    }
    const userRoles = auth?.roles ?? [];
    const hasRole = requiredRoles.some((role) => userRoles.includes(role));
    // Note: We return ALL required roles in missing[], not just the ones the user lacks.
    // This matches the original behavior for error reporting consistency.
    return hasRole
        ? { ok: true }
        : { ok: false, missing: requiredRoles, reason: 'MISSING_ROLE' };
};
/**
 * Check if the authenticated user has all of the required scopes (AND semantics).
 *
 * @param auth - The auth context from the request
 * @param requiredScopes - Array of scope names, all of which are required
 * @returns { ok: true } if user has all scopes, or { ok: false, missing, reason } with details
 *
 * @example
 * ```ts
 * const result = checkScopeAuthorization(auth, ['read:metrics', 'write:metrics']);
 * if (!result.ok) {
 *   console.log('Missing scopes:', result.missing); // ['read:metrics', 'write:metrics'] (all required)
 * }
 * ```
 */
export const checkScopeAuthorization = (auth, requiredScopes) => {
    if (!requiredScopes || requiredScopes.length === 0) {
        return { ok: true };
    }
    const userScopes = auth?.scopes ?? [];
    const hasAllScopes = requiredScopes.every((scope) => userScopes.includes(scope));
    // Note: We return ALL required scopes in missing[], not just the ones the user lacks.
    // This matches the original behavior for error reporting consistency.
    return hasAllScopes
        ? { ok: true }
        : { ok: false, missing: requiredScopes, reason: 'MISSING_SCOPE' };
};
/**
 * Middleware that requires the user to be authenticated.
 * Returns 401 if no auth context is present.
 *
 * @deprecated Use `query.requireAuth()` instead for per-endpoint authentication.
 *             This middleware is kept for complex use cases where guards aren't suitable.
 *             See: https://hypequery.com/docs/serve/authentication#middleware-helpers
 *
 * Use this as a global middleware via `api.use(requireAuthMiddleware())`.
 * For per-query guards, prefer `query.requireAuth()`.
 */
export const requireAuthMiddleware = () => async (ctx, next) => {
    if (!ctx.auth) {
        throw Object.assign(new Error("Authentication required"), {
            status: 401,
            type: "UNAUTHORIZED",
        });
    }
    return next();
};
/**
 * Middleware that requires the user to have at least one of the specified roles.
 * Returns 403 if the user lacks the required role.
 *
 * @deprecated Use `query.requireRole(...)` instead for per-endpoint authorization.
 *             This middleware is kept for complex use cases where guards aren't suitable.
 *             See: https://hypequery.com/docs/serve/authentication#middleware-helpers
 *
 * Use this as a global or per-query middleware via `api.use(requireRoleMiddleware('admin'))`.
 * For per-query guards, prefer `query.requireRole('admin')`.
 */
export const requireRoleMiddleware = (...roles) => async (ctx, next) => {
    const result = checkRoleAuthorization(ctx.auth, roles);
    if (!result.ok) {
        throw Object.assign(new Error(`Missing required role. Required one of: ${roles.join(", ")}`), { status: 403, type: "FORBIDDEN" });
    }
    return next();
};
/**
 * Middleware that requires the user to have all of the specified scopes.
 * Returns 403 if the user lacks a required scope.
 *
 * @deprecated Use `query.requireScope(...)` instead for per-endpoint authorization.
 *             This middleware is kept for complex use cases where guards aren't suitable.
 *             See: https://hypequery.com/docs/serve/authentication#middleware-helpers
 *
 * Use this as a global or per-query middleware via `api.use(requireScopeMiddleware('read:metrics'))`.
 * For per-query guards, prefer `query.requireScope('read:metrics')`.
 */
export const requireScopeMiddleware = (...scopes) => async (ctx, next) => {
    const result = checkScopeAuthorization(ctx.auth, scopes);
    if (!result.ok) {
        throw Object.assign(new Error(`Missing required scopes: ${result.missing.join(", ")}`), { status: 403, type: "FORBIDDEN" });
    }
    return next();
};
/**
 * Creates a typed auth system with compile-time role and scope safety.
 *
 * This helper provides:
 * - Type-safe auth context (combines AuthContextWithRoles and AuthContextWithScopes)
 * - A `useAuth` wrapper for auth strategies
 * - Helper to extract the typed auth type
 *
 * @example
 * ```ts
 * import { createAuthSystem, defineServe, query } from '@hypequery/serve';
 *
 * // Define your roles and scopes up front
 * const { useAuth, TypedAuth } = createAuthSystem({
 *   roles: ['admin', 'editor', 'viewer'] as const,
 *   scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] as const,
 * });
 *
 * // Extract the typed auth type for use with defineServe
 * type AppAuth = TypedAuth;
 *
 * const api = defineServe<AppAuth>({
 *   auth: useAuth(jwtStrategy),
 *   queries: {
 *     adminOnly: query.requireRole('admin').query(async ({ ctx }) => {
 *       // ✅ TypeScript autocomplete for 'admin'
 *       // ❌ Compile error on typo like 'admn'
 *       return { secret: true };
 *     }),
 *     writeData: query.requireScope('write:metrics').query(async ({ ctx }) => {
 *       // ✅ TypeScript autocomplete for 'write:metrics'
 *       return { success: true };
 *     }),
 *   },
 * });
 * ```
 */
export const createAuthSystem = (options = {}) => {
    return {
        /**
         * Type-safe wrapper for auth strategies.
         * Ensures the strategy returns auth context with the correct role/scope types.
         *
         * @example
         * ```ts
         * const jwtStrategy: AuthStrategy<AppAuth> = async ({ request }) => {
         *   const token = request.headers.authorization?.slice(7);
         *   const payload = await verifyJwt(token);
         *   return {
         *     userId: payload.sub,
         *     roles: payload.roles, // ✅ Type-checked against ['admin', 'editor', 'viewer']
         *     scopes: payload.scopes, // ✅ Type-checked against ['read:metrics', 'write:metrics']
         *   };
         * };
         *
         * const api = defineServe<AppAuth>({
         *   auth: useAuth(jwtStrategy),
         *   // ...
         * });
         * ```
         */
        useAuth: (strategy) => strategy,
        /**
         * The combined typed auth context type.
         * Use this to type your defineServe generic parameter.
         *
         * @example
         * ```ts
         * type AppAuth = typeof TypedAuth;
         * ```
         */
        TypedAuth: null,
    };
};
