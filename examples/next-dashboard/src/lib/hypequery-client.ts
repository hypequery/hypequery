import { createHooks } from '@hypequery/react';
import type { ApiDefinition } from '@/analytics/queries';

export const {
  useQuery: useHypequeryQuery,
  useMutation: useHypequeryMutation,
} = createHooks<ApiDefinition>({
  baseUrl: '/api/hypequery',
});
