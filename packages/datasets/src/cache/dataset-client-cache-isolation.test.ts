import { expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import { measure } from '../measure.js';
import { createDatasetClient } from '../executor.js';
import { createInMemoryBackend } from '../in-memory-backend.js';
import type { ExecutionContext, SemanticTenantRuntime } from '../types.js';
import type { SemanticCacheEntry, SemanticCacheStore } from './semantic-query-cache.js';

const Sales = dataset('sales', {
  source: 'sales', tenantKey: 'tenant',
  dimensions: { tenant: dimension.string(), amount: dimension.number(), id: dimension.number() },
  measures: { revenue: measure.sum('amount') },
});
const Revenue = Sales.metric('revenue', { measure: 'revenue' });
const rows = [{ tenant: 'A', amount: 10, id: 1 }, { tenant: 'B', amount: 900, id: 2 }];

it.each([Sales, Revenue])('keeps async cache execution bound to its original tenant: $name', async target => {
  const entries = new Map<string, SemanticCacheEntry>();
  let release!: () => void;
  let first = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store: SemanticCacheStore = {
    get: async key => { if (first) { first = false; await gate; } return entries.get(key); },
    set: (key, entry) => { entries.set(key, entry); },
    delete: key => { entries.delete(key); },
  };
  const client = createDatasetClient({
    backend: createInMemoryBackend({ sales: rows }), cache: { ttlMs: 60_000, store },
  });
  const context: ExecutionContext = { runtime: { tenant: { in: ['A'] } }, cache: { ttlMs: 60_000 } };
  const query = { filters: [{ field: 'id', operator: 'in' as const, value: [1] }] };
  const pending = client.execute(target, query, context);
  (context.runtime!.tenant as { in: string[] }).in[0] = 'B';
  query.filters[0]!.value[0] = 2;
  release();
  expect(Number((await pending).data[0]?.revenue)).toBe(10);

  const hit = await client.execute(target, {
    filters: [{ field: 'id', operator: 'in', value: [1] }],
  }, { runtime: { tenant: { in: ['A'] } } });
  expect(hit.meta?.cache?.hit).toBe(true);
  expect(Number(hit.data[0]?.revenue)).toBe(10);
  const other = await client.execute(target, {}, { runtime: { tenant: 'B' } });
  expect(other.meta?.cache?.hit).toBe(false);
  expect(Number(other.data[0]?.revenue)).toBe(900);
});

it.each([
  ['string', 'A'], ['id', { id: 'A' }], ['in', { in: ['A'] }], ['all', { scope: 'all' }],
] satisfies [string, SemanticTenantRuntime][])('snapshots %s runtime before an async cache miss', async (_shape, tenant) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store: SemanticCacheStore = { get: async () => { await gate; return undefined; }, set: () => {}, delete: () => {} };
  const client = createDatasetClient({ backend: createInMemoryBackend({ sales: rows }), cache: { ttlMs: 60_000, store } });
  const context: ExecutionContext = { runtime: { tenant } };
  const pending = client.execute(Sales, {}, context);
  context.runtime!.tenant = 'B';
  if (typeof tenant === 'object' && 'id' in tenant) tenant.id = 'B';
  if (typeof tenant === 'object' && 'in' in tenant) tenant.in[0] = 'B';
  release();
  expect(Number((await pending).data[0]?.revenue)).toBe(_shape === 'all' ? 910 : 10);
});
