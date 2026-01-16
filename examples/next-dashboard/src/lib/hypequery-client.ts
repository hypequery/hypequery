import { createHooks } from '@hypequery/react';
import { InferApiType } from '@hypequery/serve';

import type { api } from '@/analytics/queries';

// Automatic type inference - no manual type definition needed!
type DashboardApi = InferApiType<typeof api>;

export const {
  useQuery: useHypequeryQuery,
  useMutation: useHypequeryMutation,
  HypequeryProvider,
} = createHooks<DashboardApi>({
  baseUrl: '/api/hypequery',
});
