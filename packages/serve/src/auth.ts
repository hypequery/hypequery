import type {
  AuthContext,
  AuthContextWithRoles,
  AuthContextWithScopes,
  AuthStrategy,
  ServeMiddleware,
  ServeRequest,
} from "./types.js";

export interface ApiKeyStrategyOptions<TAuth extends AuthContext = AuthContext> {
  header?: string;
  queryParam?: string;
  validate: (key: string, request: ServeRequest) => Promise<TAuth | null> | TAuth | null;
}

export const createApiKeyStrategy = <TAuth extends AuthContext = AuthContext>(
  options: ApiKeyStrategyOptions<TAuth>
): AuthStrategy<TAuth> => {
  const headerName = options.header ?? "authorization";
  const queryParam = options.queryParam;

  return async ({ request }) => {
    let key: string | undefined;

    if (queryParam && typeof request.query[queryParam] === "string") {
      key = request.query[queryParam] as string;
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

export interface BearerTokenStrategyOptions<TAuth extends AuthContext = AuthContext> {
  header?: string;
  prefix?: string;
  validate: (token: string, request: ServeRequest) => Promise<TAuth | null> | TAuth | null;
}

export const createBearerTokenStrategy = <TAuth extends AuthContext = AuthContext>(
  options: BearerTokenStrategyOptions<TAuth>
): AuthStrategy<TAuth> => {
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
 * Result of an authorization check.
 * Returns { ok: true } if authorization succeeds, or { ok: false, missing } with details.
 */
export type AuthorizationResult =
  | { ok: true }
  | { ok: false; missing: string[]; reason: 'MISSING_ROLE' | 'MISSING_SCOPE' };

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
export const checkRoleAuthorization = (
  auth: AuthContext | null,
  requiredRoles: string[],
): AuthorizationResult => {
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
export const checkScopeAuthorization = (
  auth: AuthContext | null,
  requiredScopes: string[],
): AuthorizationResult => {
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
 * Configuration options for creating a typed auth system.
 * Enables compile-time safety for roles and scopes.
 */
export interface CreateAuthSystemOptions<
  TRoles extends string = string,
  TScopes extends string = string,
> {
  /**
   * List of valid roles for your application.
   * @example
   * ```ts
   * roles: ['admin', 'editor', 'viewer'] as const
   * ```
   */
  roles?: readonly TRoles[];

  /**
   * List of valid scopes for your application.
   * @example
   * ```ts
   * scopes: ['read:metrics', 'write:metrics', 'delete:metrics'] as const
   * ```
   */
  scopes?: readonly TScopes[];
}

/**
 * Result type from createAuthSystem.
 * Combines role and scope constraints into a single auth context type.
 */
export type TypedAuthContext<
  TRoles extends string,
  TScopes extends string,
> = AuthContextWithRoles<TRoles> & AuthContextWithScopes<TScopes>;

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
export const createAuthSystem = <
  TRoles extends string = string,
  TScopes extends string = string,
>(
  options: CreateAuthSystemOptions<TRoles, TScopes> = {}
) => {
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
    useAuth: <TAuth extends AuthContext>(
      strategy: AuthStrategy<TAuth>
    ): AuthStrategy<TAuth> => strategy,

    /**
     * The combined typed auth context type.
     * Use this to type your defineServe generic parameter.
     *
     * @example
     * ```ts
     * type AppAuth = typeof TypedAuth;
     * ```
     */
    TypedAuth: null as unknown as TypedAuthContext<TRoles, TScopes>,
  };
};
