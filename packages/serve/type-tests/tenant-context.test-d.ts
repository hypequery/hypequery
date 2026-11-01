/**
 * Compile-time checks that the tenant ID extracted by a `tenant` config is
 * visible on `ctx` inside query resolvers (manual tenant mode reads it
 * directly). Compiled by `tsc` via `tsconfig.type-tests.json`;
 * `@ts-expect-error` lines must remain errors.
 */

import { initServe } from '../src/server/init-serve.js';
import type { QueryRuntimeContext } from '../src/types.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type AppAuth = { userId: string; tenantId: string };

type _RuntimeTenantId = Expect<Equal<QueryRuntimeContext['tenantId'], string | undefined>>;

const fakeDb = {
  table: (name: string) => ({
    where: (column: string, op: 'eq', value: string | undefined) => ({ name, column, op, value }),
  }),
};

const { query, serve } = initServe<() => { db: typeof fakeDb }, AppAuth>({
  context: () => ({ db: fakeDb }),
});

// Manual mode: resolver reads the extracted tenant ID.
const getUsers = query({
  query: async ({ ctx }) => {
    const tenantId: string | undefined = ctx.tenantId;
    // @ts-expect-error tenantId may be absent (no tenant config / optional tenant)
    const required: string = ctx.tenantId;
    void required;
    return ctx.db.table('users').where('organization_id', 'eq', tenantId);
  },
});

// Per-query tenant override with optional tenant.
const adminStats = query({
  tenant: {
    required: false,
    mode: 'manual',
  },
  query: async ({ ctx }) => {
    if (ctx.tenantId) {
      const narrowed: string = ctx.tenantId;
      return ctx.db.table('stats').where('tenant_id', 'eq', narrowed);
    }
    return null;
  },
});

export const api = serve({
  tenant: {
    extract: (auth) => auth.tenantId,
    mode: 'manual',
  },
  queries: { getUsers, adminStats },
});
