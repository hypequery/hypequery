import { createHooks } from '@hypequery/react';

import type { DashboardApi } from '@/analytics/queries';

export const {
  useQuery: useHypequeryQuery,
  useMutation: useHypequeryMutation,
  HypequeryProvider,
} = createHooks<DashboardApi>({
  baseUrl: '/api/hypequery',
});
