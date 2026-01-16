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

export interface QueryMethodConfig {
  method?: string;
}

export interface CreateHooksConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  config?: Record<string, QueryMethodConfig>;
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

export function createHooks<Api extends {
  [K in keyof Api]: {
    input: unknown;
    output: unknown;
  };
}>(config: CreateHooksConfig) {
  const { baseUrl, fetchFn = fetch, headers = {}, config: methodConfig = {} } = config;

  const fetchQuery = async (name: string, input: unknown) => {
    const url = buildUrl(baseUrl, name);
    const method = methodConfig[name]?.method ?? 'POST';

    // For GET requests, encode input as query params; for others, use JSON body
    let finalUrl = url;
    let body: string | undefined;

    if (method === 'GET' && input !== undefined && input !== null) {
      const params = new URLSearchParams();
      if (typeof input === 'object') {
        for (const [key, value] of Object.entries(input)) {
          if (value !== undefined && value !== null) {
            params.append(key, String(value));
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
      const error = new Error('Request failed');
      (error as any).status = res.status;
      (error as any).body = errorBody;
      throw error;
    }

    return res.json();
  };

  type QueryOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseQueryOptions<
      QueryOutput<Api, Name>,
      Error,
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
  ): UseQueryResult<QueryOutput<Api, Name>, Error> {
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
    // Check for known TanStack Query option keys
    const optionKeys = ['enabled', 'staleTime', 'gcTime', 'refetchInterval', 'refetchOnWindowFocus'];
    return optionKeys.some(key => key in value);
  }

  type MutationOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseMutationOptions<QueryOutput<Api, Name>, Error, QueryInput<Api, Name>>,
    'mutationFn'
  >;

  function useMutation<Name extends ExtractNames<Api>>(
    name: Name,
    options?: MutationOptions<Name>
  ): UseMutationResult<QueryOutput<Api, Name>, Error, QueryInput<Api, Name>> {
    return useTanstackMutation({
      mutationFn: (input) => fetchQuery(name as string, input) as Promise<QueryOutput<Api, Name>>,
      ...options,
    });
  }

  return {
    useQuery,
    useMutation,
  } as const;
}
