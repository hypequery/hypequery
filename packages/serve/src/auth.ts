import type { AuthContext, AuthStrategy, ServeRequest } from "./types.js";

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
