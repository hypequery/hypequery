import { createHooks } from '@hypequery/react';
import { InferApiType } from '@hypequery/serve';
import type { api } from '../../api/queries';

// Automatic type inference - no manual type definition needed!
type ViteApi = InferApiType<typeof api>;

export const {
  useQuery,
  useMutation,
} = createHooks<ViteApi>({
  baseUrl: '/api',
  config: {
    hello: { method: 'GET' },
    stats: { method: 'GET' },
  },
});
