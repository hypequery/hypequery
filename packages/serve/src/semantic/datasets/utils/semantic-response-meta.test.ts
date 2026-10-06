import { expect, it } from 'vitest';
import { semanticResponseMeta } from './semantic-response-meta.js';

it('allowlists public fields while preserving operational metadata', () => {
  const meta = {
    sql: 'SELECT * FROM private_table', tenant: 'internal-tenant', parameters: ['internal-tenant'],
    timingMs: 2, rowCount: 1, pagination: { limit: 1, offset: 0, hasMore: false },
    cache: { hit: true }, resultLimit: { maxResultSize: 1, applied: 1 },
  };
  const publicMeta = semanticResponseMeta(meta);
  expect(publicMeta).toEqual({
    timingMs: 2, rowCount: 1, pagination: meta.pagination, cache: meta.cache, resultLimit: meta.resultLimit,
  });
  expect(JSON.stringify(publicMeta)).not.toContain('internal-tenant');
  expect(semanticResponseMeta(meta, true)).toMatchObject({ sql: meta.sql, tenant: meta.tenant });
  expect(semanticResponseMeta(meta, true)).not.toHaveProperty('parameters');
  expect(semanticResponseMeta(undefined)).toBeUndefined();
});

// Nested runtime metadata may contain extra fields despite its static type.
it('filters nested metadata for public and trusted responses', () => {
  const meta = {
    sql: 'SELECT 1', tenant: 'internal-tenant',
    pagination: { limit: 1, offset: 0, hasMore: false, tenant: 'internal-tenant' },
    cache: { hit: true, ageMs: 10, stale: false, sql: 'private SQL' },
    resultLimit: { maxResultSize: 2, applied: 1, parameters: ['internal-tenant'] },
  };
  for (const trusted of [false, true]) {
    const result = semanticResponseMeta(meta, trusted);
    expect(result?.pagination).toEqual({ limit: 1, offset: 0, hasMore: false });
    expect(result?.cache).toEqual({ hit: true, ageMs: 10, stale: false });
    expect(result?.resultLimit).toEqual({ maxResultSize: 2, applied: 1 });
    expect(result?.sql).toBe(trusted ? meta.sql : undefined);
    expect(result?.tenant).toBe(trusted ? meta.tenant : undefined);
  }
  expect(semanticResponseMeta({ rowCount: 1 })).toMatchObject({
    rowCount: 1, pagination: undefined, cache: undefined, resultLimit: undefined,
  });
});
