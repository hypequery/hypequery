import {
  useQuery as useTanstackQuery,
  useMutation as useTanstackMutation,
  type UseQueryOptions as TanstackUseQueryOptions,
  type UseMutationOptions as TanstackUseMutationOptions,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ExtractNames, QueryInput, QueryOutput } from './types.js';
import { HttpError } from './errors.js';

export interface QueryMethodConfig {
  method?: string;
}

export interface CreateHooksConfig<TApi = Record<string, { input: unknown; output: unknown }>> {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  config?: Record<string, QueryMethodConfig>;
  api?: TApi;
}

const OPTIONS_SYMBOL = Symbol.for('hypequery-options');

export function queryOptions<T extends object>(opts: T): T & { [OPTIONS_SYMBOL]: true } {
  return { ...opts, [OPTIONS_SYMBOL]: true as const };
}

const normalizeMethodConfig = (source?: Record<string, { method?: string }>) => {
  if (!source) return {};
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, { method: value.method ?? 'GET' }])
  );
};

const deriveMethodConfig = (api: unknown): Record<string, QueryMethodConfig> => {
  if (typeof api !== 'object' || api === null) {
    return {};
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

const buildUrl = (baseUrl: string, name: string) => {
  if (!baseUrl) {
    throw new Error('baseUrl is required');
  }
  return baseUrl.endsWith('/') ? `${baseUrl}${name}` : `${baseUrl}/${name}`;
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

export function createHooks<Api extends Record<string, { input: any; output: any }>>(
  config: CreateHooksConfig<Api>
) {
  const { baseUrl, fetchFn = fetch, headers = {}, config: explicitConfig = {}, api } = config;
  const finalConfig = { ...deriveMethodConfig(api), ...explicitConfig };

  const fetchQuery = async (
    name: string,
    input: unknown,
    defaultMethod: string = 'GET'
  ): Promise<unknown> => {
    const url = buildUrl(baseUrl, name);
    const method = finalConfig[name]?.method ?? defaultMethod;

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

  return {
    useQuery,
    useMutation,
  } as const;
}
