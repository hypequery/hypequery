import {
  useQuery as useTanstackQuery,
  useMutation as useTanstackMutation,
  useInfiniteQuery as useTanstackInfiniteQuery,
  type UseQueryOptions as TanstackUseQueryOptions,
  type UseMutationOptions as TanstackUseMutationOptions,
  type UseInfiniteQueryOptions as TanstackUseInfiniteQueryOptions,
  type UseMutationResult,
  type UseQueryResult,
  type UseInfiniteQueryResult,
  type InfiniteData,
} from '@tanstack/react-query';
import type { ExtractNames, QueryInput, QueryOutput } from './types.js';
import { HttpError } from './errors.js';

/** Shape of a paginated semantic response page (`{ data, meta.pagination }`). */
interface PaginatedPage {
  data?: unknown;
  meta?: {
    pagination?: { limit: number; offset: number; hasMore: boolean };
  };
}

export interface QueryMethodConfig {
  method?: string;
  path?: string;
}

/** A single route as produced by `@hypequery/serve`'s `api.manifest()`. */
export interface RouteManifestEntry {
  method?: string;
  path?: string;
}

/**
 * Map of query/metric/dataset keys to their HTTP method and full path. Pair
 * with `InferAPIType` and `api.manifest()` from `@hypequery/serve` to resolve
 * routes on the client without importing server code into the bundle.
 */
export type RouteManifest = Record<string, RouteManifestEntry>;

type HeaderMap = Record<string, string | undefined>;
type HeadersInput =
  | HeaderMap
  | (() => HeaderMap | Promise<HeaderMap>);

export interface CreateHooksConfig<TApi = Record<string, { input: unknown; output: unknown }>> {
  baseUrl: string;
  fetchFn?: typeof fetch;
  /**
   * Static headers, or a (optionally async) function returning headers. The
   * function is invoked per request, so it can supply a fresh/short-lived token.
   */
  headers?: HeadersInput;
  config?: Record<string, QueryMethodConfig>;
  /**
   * Route manifest from `@hypequery/serve`'s `api.manifest()`. Resolves the
   * method and full path for each key — required for metric/dataset endpoints,
   * which are POST routes whose paths differ from their map keys.
   */
  manifest?: RouteManifest;
  /**
   * Called when a request returns 401. Use it to refresh credentials (e.g. a
   * token). If it resolves without throwing, the request is retried once with
   * freshly resolved headers.
   */
  onUnauthorized?: () => void | Promise<void>;
  api?: TApi;
}

const OPTIONS_SYMBOL = Symbol.for('hypequery-options');

export function queryOptions<T extends object>(opts: T): T & { [OPTIONS_SYMBOL]: true } {
  return { ...opts, [OPTIONS_SYMBOL]: true as const };
}

const normalizeMethodConfig = (source?: Record<string, { method?: string; path?: string }>) => {
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, { method: value.method ?? 'GET', path: value.path }])
  );
};

const deriveMethodConfig = (api: unknown): Record<string, QueryMethodConfig> => {
  if (typeof api !== 'object' || api === null) {
    return {};
  }

  // Preferred: the serve API exposes a manifest() with full method + path.
  if (typeof (api as Record<string, unknown>).manifest === 'function') {
    const manifest = (api as { manifest: () => RouteManifest }).manifest();
    if (manifest && typeof manifest === 'object') {
      return normalizeMethodConfig(manifest);
    }
  }

  if (
    '_routeConfig' in api &&
    typeof (api as Record<string, unknown>)._routeConfig === 'object' &&
    (api as Record<string, unknown>)._routeConfig !== null
  ) {
    return normalizeMethodConfig((api as Record<string, Record<string, { method?: string }>>)._routeConfig);
  }

  if (
    'queries' in api &&
    typeof (api as Record<string, unknown>).queries === 'object' &&
    (api as Record<string, unknown>).queries !== null
  ) {
    return normalizeMethodConfig((api as Record<string, Record<string, { method?: string }>>).queries);
  }

  return {};
};

const isAbsoluteHttpUrl = (value: string) => /^https?:\/\//.test(value);

const ensureTrailingSlash = (value: string) => value.endsWith('/') ? value : `${value}/`;

const buildUrl = (baseUrl: string, name: string, path?: string) => {
  if (path) {
    if (isAbsoluteHttpUrl(path)) {
      return path;
    }

    if (isAbsoluteHttpUrl(baseUrl)) {
      return new URL(path, ensureTrailingSlash(baseUrl)).toString();
    }

    if (path.startsWith('/')) {
      return path;
    }

    if (!baseUrl) {
      throw new Error('baseUrl is required');
    }

    return `${ensureTrailingSlash(baseUrl)}${path}`;
  }

  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  return `${ensureTrailingSlash(baseUrl)}${name}`;
};

const parseResponse = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isOptionsBag = (value: unknown): value is { [OPTIONS_SYMBOL]: true } => {
  return Boolean(value && typeof value === 'object' && OPTIONS_SYMBOL in (value as object));
};

const looksLikeQueryOptions = (value: unknown) => {
  if (isOptionsBag(value)) return true;
  if (typeof value !== 'object' || value === null) return false;
  const optionKeys = ['enabled', 'staleTime', 'gcTime', 'refetchInterval', 'refetchOnWindowFocus', 'retry', 'retryDelay'];
  const matches = optionKeys.filter((key) => key in value).length;
  return matches >= 2;
};

const resolveHeaders = async (headers?: HeadersInput): Promise<Record<string, string>> => {
  if (!headers) return {};
  const raw = typeof headers === 'function' ? await headers() : headers;
  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined)
  ) as Record<string, string>;
};

export function createHooks<Api extends Record<string, { input: any; output: any }>>(
  config: CreateHooksConfig<Api>
) {
  const { baseUrl, fetchFn = fetch, headers = {}, config: explicitConfig = {}, manifest, onUnauthorized, api } = config;
  // Precedence: explicit config > manifest > derived from a runtime api object.
  const finalConfig = {
    ...deriveMethodConfig(api),
    ...(manifest ? normalizeMethodConfig(manifest) : {}),
    ...explicitConfig,
  };

  const fetchQuery = async (
    name: string,
    input: unknown,
    defaultMethod: string = 'GET',
    extraHeaders?: Record<string, string>,
  ): Promise<unknown> => {
    const methodConfig = finalConfig[name];

    // Semantic endpoints (dataset:<name>) live at paths that differ from their
    // map key, so without a resolved path we'd call the wrong URL. Fail loudly
    // instead of silently requesting `${baseUrl}/dataset:<name>`.
    if (name.includes(':') && !methodConfig?.path) {
      throw new Error(
        `No route configured for "${name}". Pass \`manifest\` (from the serve ` +
        `api.manifest()) or an explicit \`config\` entry to createHooks().`
      );
    }

    const url = buildUrl(baseUrl, name, methodConfig?.path);
    const method = methodConfig?.method ?? defaultMethod;

    let finalUrl = url;
    let body: string | undefined;

    if (method === 'GET' && input && typeof input === 'object') {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          value.forEach((item) => params.append(key, String(item)));
        } else {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      finalUrl = queryString ? `${url}?${queryString}` : url;
    } else if (input !== undefined) {
      body = JSON.stringify(input);
    }

    const attempt = async () => {
      const resolvedHeaders = await resolveHeaders(headers);
      return fetchFn(finalUrl, {
        method,
        headers: {
          ...resolvedHeaders,
          ...(extraHeaders ?? {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body,
      });
    };

    let res = await attempt();

    // On 401, give the caller a chance to refresh credentials and retry once.
    if (res.status === 401 && onUnauthorized) {
      await onUnauthorized();
      res = await attempt();
    }

    if (!res.ok) {
      const errorBody = await parseResponse(res);
      throw new HttpError(
        `${method} request to ${finalUrl} failed with status ${res.status}`,
        res.status,
        errorBody
      );
    }

    return res.json();
  };

  type QueryKey<Name extends ExtractNames<Api>> = QueryInput<Api, Name> extends never
    ? ['hypequery', Name]
    : ['hypequery', Name, QueryInput<Api, Name>];

  type QueryOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseQueryOptions<QueryOutput<Api, Name>, HttpError, QueryOutput<Api, Name>, QueryKey<Name>>,
    'queryKey' | 'queryFn'
  >;

  type UseQueryParams<Name extends ExtractNames<Api>> = QueryInput<Api, Name> extends never
    ? [name: Name, options?: QueryOptions<Name>]
    : [name: Name, input: QueryInput<Api, Name>, options?: QueryOptions<Name>];

  function useQuery<Name extends ExtractNames<Api>>(
    ...args: UseQueryParams<Name>
  ): UseQueryResult<QueryOutput<Api, Name>, HttpError> {
    const [name, potentialInputOrOptions, maybeOptions] = args as [
      Name,
      QueryInput<Api, Name> | QueryOptions<Name> | undefined,
      QueryOptions<Name> | undefined
    ];

    let input: QueryInput<Api, Name> | undefined;
    let options: QueryOptions<Name> | undefined;

    if (args.length === 1) {
      input = undefined;
      options = undefined;
    } else if (args.length === 2 && looksLikeQueryOptions(potentialInputOrOptions)) {
      input = undefined;
      options = potentialInputOrOptions as QueryOptions<Name>;
    } else {
      input = potentialInputOrOptions as QueryInput<Api, Name>;
      options = maybeOptions;
    }

    const queryKey = ((): QueryKey<Name> => {
      if (input === undefined) {
        return ['hypequery', name] as QueryKey<Name>;
      }
      return ['hypequery', name, input] as QueryKey<Name>;
    })();

    return useTanstackQuery({
      queryKey,
      queryFn: () => fetchQuery(name as string, input) as Promise<QueryOutput<Api, Name>>,
      ...(options ?? {}),
    });
  }

  type MutationOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseMutationOptions<QueryOutput<Api, Name>, HttpError, QueryInput<Api, Name>>,
    'mutationFn'
  >;

  function useMutation<Name extends ExtractNames<Api>>(
    name: Name,
    options?: MutationOptions<Name>
  ): UseMutationResult<QueryOutput<Api, Name>, HttpError, QueryInput<Api, Name>> {
    return useTanstackMutation({
      mutationFn: (input) => fetchQuery(name as string, input, 'POST') as Promise<QueryOutput<Api, Name>>,
      ...options,
    });
  }

  type InfiniteQueryOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseInfiniteQueryOptions<
      QueryOutput<Api, Name>,
      HttpError,
      InfiniteData<QueryOutput<Api, Name>, number>,
      QueryKey<Name>,
      number
    >,
    'queryKey' | 'queryFn' | 'getNextPageParam' | 'initialPageParam'
  >;

  /**
   * Offset-paginated query for semantic endpoints. Pages are advanced using the
   * `meta.pagination` returned by the server (the request opts into meta via the
   * `x-include-meta` header). `input.limit` is the page size; `input.offset`, if
   * provided, is the starting offset.
   */
  function useInfiniteQuery<Name extends ExtractNames<Api>>(
    name: Name,
    input: QueryInput<Api, Name>,
    options?: InfiniteQueryOptions<Name>
  ): UseInfiniteQueryResult<InfiniteData<QueryOutput<Api, Name>, number>, HttpError> {
    const initialOffset = (input as { offset?: number } | undefined)?.offset ?? 0;
    const queryKey = ['hypequery', name, input] as QueryKey<Name>;

    return useTanstackInfiniteQuery({
      queryKey,
      initialPageParam: initialOffset,
      queryFn: ({ pageParam }) =>
        fetchQuery(
          name as string,
          { ...(input as object), offset: pageParam },
          'POST',
          { 'x-include-meta': 'true' },
        ) as Promise<QueryOutput<Api, Name>>,
      getNextPageParam: (lastPage) => {
        const pagination = (lastPage as PaginatedPage).meta?.pagination;
        if (!pagination || !pagination.hasMore) return undefined;
        return pagination.offset + pagination.limit;
      },
      ...(options ?? {}),
    });
  }

  return {
    useQuery,
    useMutation,
    useInfiniteQuery,
  } as const;
}
