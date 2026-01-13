'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useState } from 'react'

import { HypequeryProvider } from '@/lib/hypequery-client'

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60, // 1 minute
        refetchOnWindowFocus: false,
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      <HypequeryProvider>
        {/* @ts-ignore */}
        {children}
      </HypequeryProvider>
    </QueryClientProvider>
  )
}
