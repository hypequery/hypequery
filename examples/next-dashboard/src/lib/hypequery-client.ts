import { createHooks } from '@hypequery/react';
import type { InferApiType } from '@hypequery/serve';
import { api } from '@/analytics/queries';

// Automatic type inference - no manual type definition needed!
type DashboardApi = InferApiType<typeof api>;

export const {
  useQuery: useHypequeryQuery,
  useMutation: useHypequeryMutation,
} = createHooks<DashboardApi>({
  baseUrl: '/api/hypequery',
  api
});
