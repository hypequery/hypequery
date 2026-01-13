import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client';
import type { IntrospectedSchema } from '@/generated/generated-schema';
import { createMemoryCache } from '@/lib/cache';

const host =
  process.env.CLICKHOUSE_HOST ??
  process.env.NEXT_PUBLIC_CLICKHOUSE_HOST ??
  'http://localhost:8123';

const username =
  process.env.CLICKHOUSE_USER ?? process.env.NEXT_PUBLIC_CLICKHOUSE_USER ?? 'default';
const password =
  process.env.CLICKHOUSE_PASSWORD ?? process.env.NEXT_PUBLIC_CLICKHOUSE_PASSWORD ?? undefined;
const database =
  process.env.CLICKHOUSE_DATABASE ?? process.env.NEXT_PUBLIC_CLICKHOUSE_DATABASE ?? 'default';

const client = createClient({
  host,
  username,
  password,
  database,
});

export const db = createQueryBuilder<IntrospectedSchema>({
  client,
  cache: {
    provider: createMemoryCache(),
    mode:
      (process.env.CACHE_MODE as 'cache-first' | 'network-first' | 'stale-while-revalidate') ??
      'stale-while-revalidate',
    ttlMs: Number(process.env.CACHE_TTL ?? process.env.NEXT_PUBLIC_CACHE_TTL ?? 5_000),
    staleTtlMs: Number(
      process.env.CACHE_STALE_TTL ?? process.env.NEXT_PUBLIC_CACHE_STALE_TTL ?? 60_000,
    ),
    staleIfError: true,
  },
});
