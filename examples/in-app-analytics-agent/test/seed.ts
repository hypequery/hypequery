import { createQueryBuilder } from '@hypequery/clickhouse';
import { createDatasetClient } from '@hypequery/datasets';

/**
 * The shared seed (examples/_seed), standing in for the ClickHouse your Cloud
 * project is connected to. Defaults match examples/_seed/docker-compose.yml.
 */
export const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USERNAME ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? 'hypequery',
  database: process.env.CLICKHOUSE_DATABASE ?? 'hypequery_examples',
});

export const analytics = createDatasetClient({ queryBuilder: db });

export async function rawEventCount(tenantId: string): Promise<number> {
  const [row] = await db.rawQuery<{ c: string }>(`SELECT count() AS c FROM events WHERE tenant_id = ${Number(tenantId)}`);
  return Number(row.c);
}
