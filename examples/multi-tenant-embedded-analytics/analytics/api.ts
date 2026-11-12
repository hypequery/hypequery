import { createAnalyticsTokenIssuer, createJwtStrategy, initServe } from '@hypequery/serve';
import { db } from './client.js';
import { Events } from './datasets.js';

/**
 * Embedded analytics, tenant-scoped end to end.
 *
 * 1. Your app authenticates the user and mints a short-lived analytics token
 *    (`issueAnalyticsToken`) whose `org_id` claim is the tenant.
 * 2. The embed sends that token as a Bearer header.
 * 3. serve verifies it (`createJwtStrategy`), extracts the tenant, and every
 *    dataset query is scoped by `tenantKey` before it reaches ClickHouse.
 */
export const AUTH = {
  secret: process.env.HYPEQUERY_AUTH_SECRET ?? 'demo-only-change-me-7c9a4b1f2e3d',
  issuer: 'https://embedded-analytics.example',
  audience: 'hypequery-analytics',
};

/** Mint on your server, in a route that already knows who the user is. */
export const issueAnalyticsToken = createAnalyticsTokenIssuer({
  ...AUTH,
  expiresIn: '15m',
});

const { serve } = initServe({
  context: () => ({ db }),
  auth: createJwtStrategy(AUTH), // sub → userId, org_id → tenantId, roles, scopes
  basePath: '/api/analytics',
});

export const api = serve({
  queryBuilder: db,
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true, // no tenant, no query
  },
  datasets: {
    events: { dataset: Events, requiredScopes: ['read:analytics'], maxLimit: 200, cache: 10_000 },
  },
});
