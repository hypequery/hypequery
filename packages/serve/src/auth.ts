import type { AuthContext, AuthStrategy, ServeMiddleware, ServeRequest } from "./types.js";

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
 * Middleware that requires the user to be authenticated.
 * Returns 401 if no auth context is present.
 *
 * Use this as a global middleware via `api.use(requireAuthMiddleware())`.
 * For per-query guards, prefer `query.requireAuth()`.
 */
export const requireAuthMiddleware = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
>(): ServeMiddleware<any, any, TContext, TAuth> =>
  async (ctx, next) => {
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
 * Use this as a global or per-query middleware via `api.use(requireRoleMiddleware('admin'))`.
 * For per-query guards, prefer `query.requireRole('admin')`.
 */
export const requireRoleMiddleware = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
>(
  ...roles: string[]
): ServeMiddleware<any, any, TContext, TAuth> =>
  async (ctx, next) => {
    const userRoles = ctx.auth?.roles ?? [];
    const hasRole = roles.some((role) => userRoles.includes(role));
    if (!hasRole) {
      throw Object.assign(
        new Error(`Missing required role. Required one of: ${roles.join(", ")}`),
        { status: 403, type: "FORBIDDEN" },
      );
    }
    return next();
  };

/**
 * Middleware that requires the user to have all of the specified scopes.
 * Returns 403 if the user lacks a required scope.
 *
 * Use this as a global or per-query middleware via `api.use(requireScopeMiddleware('read:metrics'))`.
 * For per-query guards, prefer `query.requireScope('read:metrics')`.
 */
export const requireScopeMiddleware = <
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext,
>(
  ...scopes: string[]
): ServeMiddleware<any, any, TContext, TAuth> =>
  async (ctx, next) => {
    const userScopes = ctx.auth?.scopes ?? [];
    const hasAllScopes = scopes.every((scope) => userScopes.includes(scope));
    if (!hasAllScopes) {
      const missing = scopes.filter((s) => !userScopes.includes(s));
      throw Object.assign(
        new Error(`Missing required scopes: ${missing.join(", ")}`),
        { status: 403, type: "FORBIDDEN" },
      );
    }
    return next();
  };
