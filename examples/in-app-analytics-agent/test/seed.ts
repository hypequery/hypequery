import { analytics, db } from '@/lib/analytics';

/**
 * The shared seed (examples/_seed), standing in for the ClickHouse your Cloud
 * project is connected to. Defaults match examples/_seed/docker-compose.yml.
 */
export { analytics, db };

export async function rawEventCount(tenantId: string): Promise<number> {
  const [row] = await db.rawQuery<{ c: string }>(`SELECT count() AS c FROM events WHERE tenant_id = ${Number(tenantId)}`);
  return Number(row.c);
}
