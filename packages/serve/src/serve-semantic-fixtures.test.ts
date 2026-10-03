import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dataset, dimension, measure } from '@hypequery/datasets';
import { createAPI } from './server/create-api.js';
import { AuthError, createBearerTokenStrategy } from './auth.js';
import type { ServeRequest } from './types.js';
import { semanticFixtureBuilder } from './semantic/datasets/utils/semantic-fixture-builder.js';

interface FixtureCase {
  id: string;
  method: ServeRequest['method'];
  path: string;
  credential: 'valid' | 'invalid' | 'none';
  headers?: Record<string, string>;
  tenantRequired?: boolean;
  requiredRoles?: string[];
  requiredScopes?: string[];
  json?: unknown;
  expect: {
    status: number; data?: unknown[]; meta?: false;
    pagination?: { limit: number; offset: number; hasMore: boolean };
    discovery?: unknown; errorType?: string;
  };
}

const fixtures = JSON.parse(readFileSync(new URL(
  '../../../specs/serve-http/fixtures/semantic-v1/cases.json', import.meta.url,
), 'utf8')) as {
  app: { credential: string; dataset: string; source: string; dimension: string;
    column: string; measure: string; measureField: string; maxLimit: number;
    rows: Array<Record<string, unknown>> };
  forbiddenPublicKeys: string[]; cases: FixtureCase[];
};

function assertPublic(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(assertPublic); return; }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      expect(fixtures.forbiddenPublicKeys).not.toContain(key);
      assertPublic(child);
    }
  }
}

describe('shared semantic HTTP fixtures (semantic-v1)', () => {
  it.each(fixtures.cases.map(fixture => [fixture.id, fixture] as const))('%s', async (_id, fixture) => {
    const config = fixtures.app;
    const orders = dataset(config.dataset, {
      source: config.source,
      dimensions: { country: dimension.string({ column: config.column }) },
      measures: { total: measure.count(config.measureField) },
      limits: { maxResultSize: config.maxLimit },
    });
    const api = createAPI({
      basePath: '',
      auth: createBearerTokenStrategy({ validate: token => {
        if (token !== config.credential) throw new AuthError('INVALID', 'Invalid token');
        return { userId: 'alice' };
      } }),
      ...(fixture.path.startsWith('/metrics')
        ? { metrics: { total: orders.metric('total', { measure: 'total' }) } }
        : { datasets: { orders: {
          dataset: orders,
          requiredRoles: fixture.requiredRoles,
          requiredScopes: fixture.requiredScopes,
        } } }),
      ...(fixture.tenantRequired ? { tenant: { extract: () => undefined, required: true } } : {}),
      queryBuilder: semanticFixtureBuilder(config.rows),
    });
    const headers: Record<string, string> = { ...fixture.headers };
    if (fixture.credential !== 'none') {
      headers.authorization = `Bearer ${config.credential}${fixture.credential === 'invalid' ? '-wrong' : ''}`;
    }
    if (fixture.json !== undefined) headers['content-type'] = 'application/json';
    const response = await api.handler({ method: fixture.method, path: fixture.path,
      headers, query: {}, ...(fixture.json !== undefined ? { body: fixture.json } : {}) });
    const body = JSON.parse(JSON.stringify(response.body));
    const expected = fixture.expect;
    expect(response.status).toBe(expected.status);
    const header = (name: string) => Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
    expect(header('x-request-id')).toBeTruthy();
    // Discovery is public in TypeScript; authenticated execution and all errors are no-store.
    if (fixture.path !== '/discovery') expect(header('cache-control')).toBe('no-store');
    assertPublic(body);
    if (expected.data) expect(body.data).toEqual(expected.data);
    if (expected.meta === false) expect(body.meta).toBeUndefined();
    if (expected.pagination) {
      expect(body.meta.pagination).toEqual(expected.pagination);
      expect(body.meta.rowCount).toBe(body.data.length);
      expect(typeof body.meta.timingMs).toBe('number');
      expect(body.meta.cache).toEqual({ hit: false });
    }
    if (expected.errorType) expect(body.error.type).toBe(expected.errorType);
    if (expected.discovery) expect(body).toEqual(expected.discovery);
  });
});
