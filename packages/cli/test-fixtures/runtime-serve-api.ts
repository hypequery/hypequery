import { createAPI } from '@hypequery/serve';

let observedRequestId: string | undefined;

export const api = createAPI({
  context: () => ({ prefix: 'Serve context' }),
  queries: {
    greeting: {
      query: async ({ input, ctx }) =>
        `${ctx.prefix}: hello ${(input as { name: string }).name}`,
    },
    requestTrace: {
      query: async () => observedRequestId,
    },
  },
});

api.queryLogger.on((event) => {
  if (event.status === 'started') observedRequestId = event.requestId;
});
