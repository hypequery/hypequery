import type {
  AuthContext,
  AuthStrategy,
  AuthStrategyContext,
  AuthErrorInfo,
  ServeRequest,
} from "./types.js";
import {
  SignJWT,
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";

const resolveHeaderValue = (value: unknown): string | undefined => {
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === "string");
    return typeof first === "string" ? first : undefined;
  }
  if (typeof value === "string") return value;
  return undefined;
};

/**
 * Safely read a header from a ServeRequest with case-insensitive
 * and array-safe normalization.
 */
export const getHeader = (request: ServeRequest, name: string): string | undefined => {
  const target = name.toLowerCase();
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const direct = headers[target] ?? headers[name] ?? headers[name.toLowerCase()];
  const resolvedDirect = resolveHeaderValue(direct);
  if (resolvedDirect !== undefined) {
    const trimmed = resolvedDirect.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === target);
  const resolvedMatch = resolveHeaderValue(match?.[1]);
  if (resolvedMatch === undefined) return undefined;
  const trimmed = resolvedMatch.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class AuthError extends Error implements AuthErrorInfo {
  reason: AuthErrorInfo["reason"];
  details?: Record<string, unknown>;

  constructor(reason: AuthErrorInfo["reason"], message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "AuthError";
    this.reason = reason;
    this.details = details;
  }
}

export interface ApiKeyAuthOptions<TAuth extends AuthContext = AuthContext> {
  header?: string;
  allowMissing?: boolean;
  validate: (key: string, request: ServeRequest) => Promise<TAuth | null> | TAuth | null;
}

/**
 * Simple API key auth adapter with clear missing/invalid errors.
 */
export const apiKeyAuth = <TAuth extends AuthContext = AuthContext>(
  options: ApiKeyAuthOptions<TAuth>
): AuthStrategy<TAuth> => {
  const headerName = options.header ?? "x-api-key";
  const allowMissing = options.allowMissing ?? false;

  return async ({ request }) => {
    const key = getHeader(request, headerName);
    if (!key) {
      if (allowMissing) return null;
      throw new AuthError("MISSING", `Missing API key in "${headerName}" header`, { header: headerName });
    }

    const auth = await options.validate(key, request);
    if (!auth) {
      throw new AuthError("INVALID", `Invalid API key in "${headerName}" header`, { header: headerName });
    }
    return auth;
  };
};

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
      const headerValue = getHeader(request, headerName);
      if (headerValue) {
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
    const raw = getHeader(request, headerName);
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

export const fromContext = <TAuth extends AuthContext = AuthContext>(
  extract: (context: AuthStrategyContext) => Promise<TAuth | null> | TAuth | null,
): AuthStrategy<TAuth> => async (context) => extract(context);

interface BaseJwtStrategyOptions<TAuth extends AuthContext = AuthContext> {
  /** Expected token issuer(s). */
  issuer?: string | string[];
  /** Expected audience(s). */
  audience?: string | string[];
  /** Allowed signature algorithms. Defaults to `['HS256']` for secrets and `['RS256']` for JWKS. */
  algorithms?: string[];
  /** Header carrying the token. @default "authorization" */
  header?: string;
  /** Token prefix. @default "Bearer " */
  prefix?: string;
  /** When true, a missing token resolves to `null` instead of throwing. */
  optional?: boolean;
  /**
   * Maps verified JWT claims to your auth context. Defaults to mapping
   * `sub`→`userId`, `org_id`→`tenantId`, `roles`→`roles`, and
   * `scope`/`scopes`→`scopes`.
   */
  mapClaims?: (
    payload: JWTPayload,
    request: ServeRequest,
  ) => TAuth | null | Promise<TAuth | null>;
}

export interface SecretJwtStrategyOptions<TAuth extends AuthContext = AuthContext>
  extends BaseJwtStrategyOptions<TAuth> {
  /** Shared secret for symmetric JWT verification. Defaults algorithms to `['HS256']`. */
  secret: string | Uint8Array;
  jwksUri?: never;
}

export interface JwksJwtStrategyOptions<TAuth extends AuthContext = AuthContext>
  extends BaseJwtStrategyOptions<TAuth> {
  /** Remote JWKS endpoint for asymmetric JWT verification. Defaults algorithms to `['RS256']`. */
  jwksUri: string;
  secret?: never;
}

export type JwtStrategyOptions<TAuth extends AuthContext = AuthContext> =
  | SecretJwtStrategyOptions<TAuth>
  | JwksJwtStrategyOptions<TAuth>;

type JwtStrategyOptionsWithMapper<TAuth extends AuthContext> =
  JwtStrategyOptions<TAuth> & {
    mapClaims: (
      payload: JWTPayload,
      request: ServeRequest,
    ) => TAuth | null | Promise<TAuth | null>;
  };

const defaultJwtClaimMapper = (payload: JWTPayload): AuthContext => {
  const scopeClaim = payload.scope ?? payload.scopes;
  const scopes = typeof scopeClaim === "string"
    ? scopeClaim.split(" ").filter(Boolean)
    : Array.isArray(scopeClaim)
      ? scopeClaim.filter((scope): scope is string => typeof scope === "string")
      : undefined;
  const roles = Array.isArray(payload.roles)
    ? payload.roles.filter((role): role is string => typeof role === "string")
    : undefined;
  return {
    userId: typeof payload.sub === "string" ? payload.sub : undefined,
    tenantId: typeof payload.org_id === "string" ? payload.org_id : undefined,
    roles,
    scopes,
    metadata: payload as Record<string, unknown>,
  };
};

/**
 * Verifies JWT bearer tokens with either a shared secret (HS256 by default) or
 * a remote JWKS (RS256 by default). Use shared secrets when you mint the token
 * yourself, and JWKS when a provider such as Auth0, Clerk, or Cognito mints it.
 *
 * @example
 * ```ts
 * const api = createAPI({
 *   auth: createJwtStrategy({
 *     jwksUri: 'https://example.auth0.com/.well-known/jwks.json',
 *     issuer: 'https://example.auth0.com/',
 *     audience: 'https://api.example.com',
 *   }),
 *   queries: { ... },
 * });
 * ```
 */
const resolveSecretKey = (secret: string | Uint8Array, helperName: string) => {
  if (typeof secret === "string") {
    if (secret.length === 0) {
      throw new Error(`${helperName}: \`secret\` must not be empty.`);
    }
    return new TextEncoder().encode(secret);
  }

  if (secret.byteLength === 0) {
    throw new Error(`${helperName}: \`secret\` must not be empty.`);
  }
  return secret;
};

const isSecretJwtOptions = <TAuth extends AuthContext>(
  options: JwtStrategyOptions<TAuth>,
): options is SecretJwtStrategyOptions<TAuth> =>
  "secret" in options && options.secret != null;

const isJwksJwtOptions = <TAuth extends AuthContext>(
  options: JwtStrategyOptions<TAuth>,
): options is JwksJwtStrategyOptions<TAuth> =>
  "jwksUri" in options && options.jwksUri != null;

export function createJwtStrategy(options: JwtStrategyOptions<AuthContext>): AuthStrategy<AuthContext>;
export function createJwtStrategy<TAuth extends AuthContext>(
  options: JwtStrategyOptionsWithMapper<TAuth>
): AuthStrategy<TAuth>;
export function createJwtStrategy<TAuth extends AuthContext>(
  options: JwtStrategyOptions<TAuth>
): AuthStrategy<AuthContext | TAuth> {
  const hasSecret = isSecretJwtOptions(options);
  const hasJwksUri = isJwksJwtOptions(options);
  if (hasSecret === hasJwksUri) {
    throw new Error("createJwtStrategy: provide exactly one of `secret` or `jwksUri`.");
  }

  const headerName = options.header ?? "authorization";
  const prefix = options.prefix ?? "Bearer ";
  const mapClaims = options.mapClaims
    ?? defaultJwtClaimMapper;

  let verify: (token: string) => Promise<{ payload: JWTPayload }>;
  if (hasSecret) {
    const key = resolveSecretKey(options.secret, "createJwtStrategy");
    verify = (token) =>
      jwtVerify(token, key, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms ?? ["HS256"],
      });
  } else {
    if (options.jwksUri.trim().length === 0) {
      throw new Error("createJwtStrategy: `jwksUri` must not be empty.");
    }
    const jwks = createRemoteJWKSet(new URL(options.jwksUri));
    verify = (token) =>
      jwtVerify(token, jwks, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms ?? ["RS256"],
      });
  }

  return async ({ request }) => {
    const raw = getHeader(request, headerName);
    if (typeof raw !== "string" || !raw.startsWith(prefix)) {
      if (options.optional) return null;
      throw new AuthError("MISSING", `Missing bearer token in "${headerName}" header`, { header: headerName });
    }
    const token = raw.slice(prefix.length).trim();
    if (!token) {
      if (options.optional) return null;
      throw new AuthError("MISSING", `Empty bearer token in "${headerName}" header`, { header: headerName });
    }

    let payload: JWTPayload;
    try {
      const verified = await verify(token);
      payload = verified.payload;
    } catch (error) {
      throw new AuthError("INVALID", "JWT verification failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return mapClaims(payload, request);
  };
}

export interface AnalyticsTokenIssuerOptions {
  secret: string | Uint8Array;
  expiresIn?: string;
  issuer?: string;
  audience?: string;
  algorithm?: "HS256" | "HS384" | "HS512";
}

export type AnalyticsTokenClaims = Pick<AuthContext, "tenantId" | "roles"> & {
  userId: string;
};

export const createAnalyticsTokenIssuer = (options: AnalyticsTokenIssuerOptions) => {
  const key = resolveSecretKey(options.secret, "createAnalyticsTokenIssuer");
  const algorithm = options.algorithm ?? "HS256";

  return async (claims: AnalyticsTokenClaims) => {
    let jwt = new SignJWT({
      ...(claims.tenantId ? { org_id: claims.tenantId } : {}),
      ...(claims.roles ? { roles: claims.roles } : {}),
    })
      .setProtectedHeader({ alg: algorithm })
      .setSubject(claims.userId)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "15m");

    if (options.issuer) jwt = jwt.setIssuer(options.issuer);
    if (options.audience) jwt = jwt.setAudience(options.audience);

    return jwt.sign(key);
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
