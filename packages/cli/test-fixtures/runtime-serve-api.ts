import { createAPI } from '@hypequery/serve';

let observedRequestId: string | undefined;

export const api = createAPI({
  auth: async () => null as {
    userId: string;
    tenantId: string;
    roles: string[];
    scopes: string[];
  } | null,
  context: ({ auth }) => ({
    prefix: 'Serve context',
    userId: auth?.userId ?? 'anonymous',
  }),
  tenant: {
    extract: auth => auth.tenantId,
    required: true,
  },
  queries: {
    greeting: {
      requiredRoles: ['analyst'],
      requiredScopes: ['greeting:read'],
      query: async ({ input, ctx }) => [
        `${ctx.prefix}: hello ${(input as { name: string }).name}`,
        ctx.userId,
        ctx.tenantId,
      ].join(' / '),
    },
    requestTrace: {
      query: async () => observedRequestId,
    },
  },
});

api.queryLogger.on((event) => {
  if (event.status === 'started') observedRequestId = event.requestId;
});
