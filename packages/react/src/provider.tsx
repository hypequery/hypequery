import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ApiContract, HypequeryClient } from './client.js';

const HypequeryContext = createContext<HypequeryClient<ApiContract> | null>(null);

export interface HypequeryProviderProps<Api extends ApiContract = ApiContract> {
  client: HypequeryClient<Api>;
  children: ReactNode;
  /** Reuse an application's existing TanStack Query client when supplied. */
  queryClient?: QueryClient;
}

export function HypequeryProvider<Api extends ApiContract>({
  client,
  children,
  queryClient,
}: HypequeryProviderProps<Api>) {
  const [defaultQueryClient] = useState(() => new QueryClient());
  return (
    <HypequeryContext.Provider value={client as HypequeryClient<ApiContract>}>
      <QueryClientProvider client={queryClient ?? defaultQueryClient}>
        {children}
      </QueryClientProvider>
    </HypequeryContext.Provider>
  );
}

export function useHypequeryClient<Api extends ApiContract = ApiContract>() {
  const client = useOptionalHypequeryClient<Api>();
  if (!client) {
    throw new Error('Hypequery hooks must be rendered inside <HypequeryProvider>.');
  }
  return client;
}

export function useOptionalHypequeryClient<Api extends ApiContract = ApiContract>() {
  return useContext(HypequeryContext) as HypequeryClient<Api> | null;
}
