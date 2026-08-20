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
import {
  createHypequeryClient,
  type ApiContract,
  type HypequeryClient,
  type HypequeryClientConfig,
} from './client.js';
import { useOptionalHypequeryClient } from './provider.js';

/** Shape of a paginated semantic response page (`{ data, meta.pagination }`). */
interface PaginatedPage {
  data?: unknown;
  meta?: {
    pagination?: { limit: number; offset: number; hasMore: boolean };
  };
}

export type CreateHooksConfig<TApi extends ApiContract = ApiContract> =
  HypequeryClientConfig<TApi>;

const OPTIONS_SYMBOL = Symbol.for('hypequery-options');

export function queryOptions<T extends object>(opts: T): T & { [OPTIONS_SYMBOL]: true } {
  return { ...opts, [OPTIONS_SYMBOL]: true as const };
}

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

export function createHooks<Api extends ApiContract>(
  config?: CreateHooksConfig<Api>
) {
  const configuredClient = config ? createHypequeryClient(config) : null;

  function useResolvedClient(): HypequeryClient<Api> {
    const providerClient = useOptionalHypequeryClient<Api>();
    const client = configuredClient ?? providerClient;
    if (!client) {
      throw new Error('Configure createHooks() directly or render inside <HypequeryProvider>.');
    }
    return client;
  }

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
    const client = useResolvedClient();
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
      queryFn: () => client.request(name as string, input) as Promise<QueryOutput<Api, Name>>,
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
    const client = useResolvedClient();
    return useTanstackMutation({
      mutationFn: (input) => client.request(name as string, input, 'POST') as Promise<QueryOutput<Api, Name>>,
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
    const client = useResolvedClient();
    const initialOffset = (input as { offset?: number } | undefined)?.offset ?? 0;
    const queryKey = ['hypequery', name, input] as QueryKey<Name>;

    return useTanstackInfiniteQuery({
      queryKey,
      initialPageParam: initialOffset,
      queryFn: ({ pageParam }) =>
        client.request(
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
