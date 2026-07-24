import { createAPI } from '@hypequery/serve';

export const api = createAPI({
  context: () => ({ prefix: 'Serve context' }),
  queries: {
    greeting: {
      query: async ({ input, ctx }) =>
        `${ctx.prefix}: hello ${(input as { name: string }).name}`,
    },
  },
});
