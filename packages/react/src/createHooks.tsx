import {
  useQuery as useTanstackQuery,
  useMutation as useTanstackMutation,
  type UseQueryOptions as TanstackUseQueryOptions,
  type UseMutationOptions as TanstackUseMutationOptions,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {

  ExtractNames,
  QueryInput,
  QueryOutput,
} from './types.js';
import { HttpError } from './errors.js';

export interface QueryMethodConfig {
  method?: string;
}

// Type to detect if something is a ServeBuilder (has queries property with endpoints)
type MaybeServeBuilder = {
  queries: Record<string, { method?: string }>;
  _routeConfig?: Record<string, { method?: string }>;
};

export interface CreateHooksConfig<TApi = any> {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  config?: Record<string, QueryMethodConfig>;
  api?: TApi;
}

/**
 * Symbol used to mark objects as query options (not input)
 * @internal
 */
const OPTIONS_SYMBOL = Symbol.for('hypequery-options');

/**
 * Helper to explicitly mark an object as query options
 * Prevents ambiguity when query input and options have overlapping properties
 *
 * @example
 * ```ts
 * // Without helper - ambiguous (could be input or options)
 * useQuery('getData', { enabled: true, staleTime: 5000 })
 *
 * // With helper - explicit
 * useQuery('getData', queryOptions({ enabled: true, staleTime: 5000 }))
 * ```
 */
export function queryOptions<T extends object>(opts: T): T & { [OPTIONS_SYMBOL]: true } {
  return { ...opts, [OPTIONS_SYMBOL]: true as const };
}

function buildUrl(baseUrl: string, name: string) {
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  return baseUrl.endsWith('/') ? `${baseUrl}${name}` : `${baseUrl}/${name}`;
}

async function parseResponse(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Type guard to check if API object has route-level config
 */
function hasRouteConfig(api: unknown): api is { _routeConfig: Record<string, { method?: string }> } {
  return (
    typeof api === 'object' &&
    api !== null &&
    '_routeConfig' in api &&
    typeof (api as any)._routeConfig === 'object' &&
    (api as any)._routeConfig !== null
  );
}

/**
 * Type guard to check if API object has queries property
 */
function hasQueries(api: unknown): api is { queries: Record<string, { method?: string }> } {
  return (
    typeof api === 'object' &&
    api !== null &&
    'queries' in api &&
    typeof (api as any).queries === 'object' &&
    (api as any).queries !== null
  );
}

/**
 * Extract method configuration from a source object
 * Transforms { key: { method: 'POST' } } into { key: { method: 'POST' } }
 * with GET as default
 */
function extractMethodConfig<T extends { method?: string }>(
  source: Record<string, T>
): Record<string, QueryMethodConfig> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      { method: value.method || 'GET' },
    ])
  );
}

export function createHooks<Api extends {
  [K in keyof Api]: {
    input: unknown;
    output: unknown;
  };
}>(config: CreateHooksConfig) {
  const { baseUrl, fetchFn = fetch, headers = {}, config: methodConfig = {}, api } = config;

  // Auto-extract method config from api object if provided
  const extractedConfig: Record<string, QueryMethodConfig> = api
    ? hasRouteConfig(api)
      ? extractMethodConfig(api._routeConfig)  // Prefer route-level config if available
      : hasQueries(api)
        ? extractMethodConfig(api.queries)     // Fallback to endpoint method
        : {}
    : {};

  // Merge extracted config with explicit config (explicit takes precedence)
  const finalConfig = { ...extractedConfig, ...methodConfig };

  const fetchQuery = async (name: string, input: unknown, defaultMethod: string = 'GET') => {
    const url = buildUrl(baseUrl, name);
    const method = finalConfig[name]?.method ?? defaultMethod;

    // For GET requests, encode input as query params; for others, use JSON body
    let finalUrl = url;
    let body: string | undefined;

    if (method === 'GET' && input !== undefined && input !== null) {
      const params = new URLSearchParams();
      if (typeof input === 'object') {
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined && value !== null) {
            // Handle arrays by appending multiple values with the same key
            if (Array.isArray(value)) {
              value.forEach(item => params.append(key, String(item)));
            } else {
              params.append(key, String(value));
            }
          }
        }
      }
      const queryString = params.toString();
      finalUrl = queryString ? `${url}?${queryString}` : url;
    } else if (input !== undefined) {
      body = JSON.stringify(input);
    }

    const res = await fetchFn(finalUrl, {
      method,
      headers: {
        ...headers,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body,
    });

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

  type QueryOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseQueryOptions<
      QueryOutput<Api, Name>,
      HttpError,
      QueryOutput<Api, Name>,
      ['hypequery', Name, QueryInput<Api, Name>]
    >,
    'queryKey' | 'queryFn'
  >;

  // Conditional type to make input optional when it's unknown (no input schema)
  type UseQueryParams<Name extends ExtractNames<Api>> = QueryInput<Api, Name> extends unknown
    ? unknown extends QueryInput<Api, Name>
    ? [name: Name, options?: QueryOptions<Name>]
    : [name: Name, input: QueryInput<Api, Name>, options?: QueryOptions<Name>]
    : [name: Name, input: QueryInput<Api, Name>, options?: QueryOptions<Name>];

  function useQuery<Name extends ExtractNames<Api>>(
    ...args: UseQueryParams<Name>
  ): UseQueryResult<QueryOutput<Api, Name>, HttpError> {
    const [name, inputOrOptions, maybeOptions] = args;

    // Parse arguments based on count and type
    let input: QueryInput<Api, Name> | undefined;
    let options: QueryOptions<Name> | undefined;

    if (args.length === 1) {
      // useQuery('queryName')
      input = undefined;
      options = undefined;
    } else if (args.length === 2) {
      // useQuery('queryName', input) or useQuery('queryName', options)
      if (isQueryOptions(inputOrOptions)) {
        input = undefined;
        options = inputOrOptions as QueryOptions<Name>;
      } else {
        input = inputOrOptions as QueryInput<Api, Name>;
        options = undefined;
      }
    } else {
      // useQuery('queryName', input, options)
      input = inputOrOptions as QueryInput<Api, Name>;
      options = maybeOptions;
    }

    return useTanstackQuery({
      queryKey: ['hypequery', name, input] as ['hypequery', Name, QueryInput<Api, Name>],
      queryFn: () => fetchQuery(name as string, input) as Promise<QueryOutput<Api, Name>>,
      ...(options ?? {}),
    });
  }

  function isQueryOptions(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;

    // Check for explicit symbol marker first (most reliable)
    if (OPTIONS_SYMBOL in value) return true;

    // Fallback to heuristic for backward compatibility
    // Check for known TanStack Query option keys
    // Must have at least 2 matches to avoid false positives with user input
    const optionKeys = ['enabled', 'staleTime', 'gcTime', 'refetchInterval', 'refetchOnWindowFocus', 'retry', 'retryDelay'];
    const matches = optionKeys.filter(key => key in value).length;
    return matches >= 2;
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

  return {
    useQuery,
    useMutation,
  } as const;
}
