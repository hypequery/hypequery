import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client';
import type { IntrospectedSchema } from '../generated/generated-schema';
import { createMemoryCache } from '../lib/cache';

const resolveEnv = (...keys: (keyof NodeJS.ProcessEnv)[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
};

const host = resolveEnv('CLICKHOUSE_HOST', 'NEXT_PUBLIC_CLICKHOUSE_HOST');

if (!host) {
  throw new Error(
    'Missing CLICKHOUSE_HOST (or NEXT_PUBLIC_CLICKHOUSE_HOST) environment variable. Copy examples/next-dashboard/.env.example to .env and fill it in.',
  );
}

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
