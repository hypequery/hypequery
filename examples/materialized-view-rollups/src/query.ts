import { between } from '@hypequery/datasets';
import { analytics, db } from './client.js';
import { Events, EventsDaily, TenantDailySummary } from './datasets.js';

/** The seed's last full week; fixed so output is reproducible. */
export const RANGE: [string, string] = ['2026-10-25', '2026-10-31'];

export interface Comparison {
  /** Same question, answered from the raw table and from the incremental rollup. */
  raw: Array<Record<string, unknown>>;
  incremental: Array<Record<string, unknown>>;
  /** Per-plan view that only the refreshable rollup can answer (it joins tenants). */
  refreshable: Array<Record<string, unknown>>;
  timingsMs: { raw: number; incremental: number; refreshable: number };
}

const perDay = {
  by: 'day',
  measures: ['events', 'uniqueUsers', 'errorRate'],
  orderBy: [{ field: 'period', direction: 'asc' }],
} as const;

export async function compare(): Promise<Comparison> {
  const raw = await analytics.execute(Events, {
    ...perDay,
    filters: [between('occurredAt', `${RANGE[0]} 00:00:00`, `${RANGE[1]} 23:59:59`)],
  });
  const incremental = await analytics.execute(EventsDaily, {
    ...perDay,
    filters: [between('day', RANGE[0], RANGE[1])],
  });
  const refreshable = await analytics.execute(TenantDailySummary, {
    dimensions: ['plan'],
    measures: ['events', 'errorRate', 'worstP95LatencyMs'],
    filters: [between('day', RANGE[0], RANGE[1])],
    orderBy: [{ field: 'events', direction: 'desc' }],
  });
  return {
    raw: raw.data,
    incremental: incremental.data,
    refreshable: refreshable.data,
    timingsMs: {
      raw: raw.meta?.timingMs ?? 0,
      incremental: incremental.meta?.timingMs ?? 0,
      refreshable: refreshable.meta?.timingMs ?? 0,
    },
  };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  compare()
    .then(async (result) => {
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Events per day, ${RANGE[0]} to ${RANGE[1]}\n`);
        console.log(`Raw events table (${result.timingsMs.raw} ms):`);
        console.table(result.raw);
        console.log(`Incremental rollup, events_daily (${result.timingsMs.incremental} ms):`);
        console.table(result.incremental);
        console.log(`Refreshable rollup by plan, tenant_daily_summary (${result.timingsMs.refreshable} ms):`);
        console.table(result.refreshable);
      }
      await db.close();
    })
    .catch(async (error) => {
      console.error(error instanceof Error ? error.message : error);
      await db.close();
      process.exit(1);
    });
}
