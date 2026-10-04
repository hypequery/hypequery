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
