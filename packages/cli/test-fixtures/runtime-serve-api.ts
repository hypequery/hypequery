import { createAPI } from '@hypequery/serve';

export const api = createAPI({
  queries: {
    greeting: {
      query: async ({ input }) => `Hello ${(input as { name: string }).name}`,
    },
  },
});
