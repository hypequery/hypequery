import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PropsWithChildren } from 'react';
import {
  useQuery as useTanstackQuery,
  useMutation as useTanstackMutation,
  type UseQueryOptions as TanstackUseQueryOptions,
  type UseMutationOptions as TanstackUseMutationOptions,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { createHttpClient, type HttpClientOptions } from './client.js';
import {
  type HypequeryApiRecord,
  type ExtractNames,
  type QueryInput,
  type QueryOutput,
} from './types.js';

interface CreateHooksConfig extends HttpClientOptions { }

type ProviderProps = PropsWithChildren<{ children?: ReactNode }>;

export function createHooks<Api extends HypequeryApiRecord>(config: CreateHooksConfig) {
  const HypequeryContext = createContext<ReturnType<typeof createHttpClient> | null>(null);

  function HypequeryProvider({ children }: ProviderProps) {
    const client = useMemo(() => createHttpClient(config), []);
    return <HypequeryContext.Provider value={client}>{children}</HypequeryContext.Provider>;
  }

  const useClient = () => {
    const client = useContext(HypequeryContext);
    if (!client) {
      throw new Error('HypequeryProvider is missing. Wrap your app in <HypequeryProvider />');
    }
    return client;
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

  function useQuery<Name extends ExtractNames<Api>>(
    name: Name,
    input: QueryInput<Api, Name>,
    options?: QueryOptions<Name>
  ): UseQueryResult<QueryOutput<Api, Name>, Error> {
    const client = useClient();
    return useTanstackQuery({
      queryKey: ['hypequery', name, input],
      queryFn: () => client.runQuery(name as string, input),
      ...options,
    });
  }

  type MutationOptions<Name extends ExtractNames<Api>> = Omit<
    TanstackUseMutationOptions<QueryOutput<Api, Name>, Error, QueryInput<Api, Name>>,
    'mutationFn'
  >;

  function useMutation<Name extends ExtractNames<Api>>(
    name: Name,
    options?: MutationOptions<Name>
  ): UseMutationResult<QueryOutput<Api, Name>, Error, QueryInput<Api, Name>> {
    const client = useClient();
    return useTanstackMutation({
      mutationFn: (input) => client.runMutation(name as string, input),
      ...options,
    });
  }

  return {
    useQuery,
    useMutation,
    HypequeryProvider,
  } as const;
}
