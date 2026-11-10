import { toStartOfDay } from '@hypequery/clickhouse';
import { createApiKeyStrategy, initServe, rateLimit, ServeHttpError } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client.js';
import { findApiKey } from './keys.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  basePath: '', // /openapi.json and /docs at the root, endpoints under /api
  auth: createApiKeyStrategy({ validate: findApiKey }), // Authorization: Bearer <key>
  middlewares: [rateLimit({ windowMs: 60_000, max: 120, keyBy: (ctx) => ctx.auth?.userId ?? null })],
});

/** Shared, validated date range. GET query strings are coerced, then checked. */
const range = {
  from: z.iso.date().default('2026-10-01').describe('First UTC day, inclusive (YYYY-MM-DD)'),
  to: z.iso.date().default('2026-10-31').describe('Last UTC day, inclusive (YYYY-MM-DD)'),
};
const between = (i: { from: string; to: string }): [string, string] => [`${i.from} 00:00:00`, `${i.to} 23:59:59`];

const dailyActiveUsers = query({
  summary: 'Daily active users',
  description: 'Distinct users with at least one event, per UTC day.',
  tags: ['metrics'],
  input: z.object(range),
  output: z.array(z.object({ day: z.string(), activeUsers: z.number() })),
  query: async ({ ctx, input }) => {
    const rows = await ctx.db.table('events')
      .select([toStartOfDay('occurred_at', 'day')])
      .countDistinct('user_id', 'activeUsers')
      .where('occurred_at', 'between', between(input))
      .groupBy('day')
      .orderBy('day', 'ASC')
      .execute();
    return rows.map((r) => ({ day: String(r.day).slice(0, 10), activeUsers: Number(r.activeUsers) }));
  },
});

const tenantUsage = query({
  summary: 'Usage for one tenant',
  description: 'Events, active users, 5xx errors and p95 latency for a tenant over a date range.',
  tags: ['tenants'],
  input: z.object({ tenantId: z.number().int().positive().describe('Tenant id from the tenants table'), ...range }),
  output: z.object({
    tenantId: z.number(), name: z.string(), plan: z.string(),
    events: z.number(), activeUsers: z.number(), errors: z.number(), p95LatencyMs: z.number(),
  }),
  query: async ({ ctx, input }) => {
    const [tenant] = await ctx.db.table('tenants').select(['name', 'plan']).where('tenant_id', 'eq', input.tenantId).execute();
    if (!tenant) throw new ServeHttpError(404, 'NOT_FOUND', `No tenant ${input.tenantId}`);
    const scoped = ctx.db.table('events').where('tenant_id', 'eq', input.tenantId).where('occurred_at', 'between', between(input));
    const [usage] = await scoped.count('event_id', 'events').countDistinct('user_id', 'activeUsers')
      .quantile('latency_ms', 0.95, 'p95LatencyMs').execute();
    const [failed] = await scoped.where('status_code', 'gte', 500).count('event_id', 'errors').execute();
    return {
      tenantId: input.tenantId, name: tenant.name, plan: tenant.plan,
      events: Number(usage.events), activeUsers: Number(usage.activeUsers),
      errors: Number(failed.errors), p95LatencyMs: Math.round(Number(usage.p95LatencyMs)),
    };
  },
});

const topPaths = query({
  summary: 'Busiest paths',
  tags: ['metrics'],
  input: z.object({ ...range, limit: z.number().int().min(1).max(50).default(10) }),
  output: z.array(z.object({ path: z.string(), events: z.number() })),
  query: async ({ ctx, input }) => {
    const rows = await ctx.db.table('events').select(['path']).count('event_id', 'events')
      .where('occurred_at', 'between', between(input)).groupBy('path').orderBy('events', 'DESC').limit(input.limit).execute();
    return rows.map((r) => ({ path: r.path, events: Number(r.events) }));
  },
});

export const api = serve({
  queries: { dailyActiveUsers, tenantUsage, topPaths },
  openapi: { info: { title: 'ClickHouse analytics REST API', description: 'Typed endpoints over ClickHouse, served by hypequery.' }, version: '1.0.0' },
  docs: { title: 'ClickHouse analytics REST API', subtitle: 'Send Authorization: Bearer <key> on every /api request' },
});

api
  .route('/api/metrics/daily-active-users', api.queries.dailyActiveUsers)
  .route('/api/tenants/usage', api.queries.tenantUsage)
  .route('/api/metrics/top-paths', api.queries.topPaths);
