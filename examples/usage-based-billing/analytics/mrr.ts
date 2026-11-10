import { gt, lte } from '@hypequery/datasets';
import { analytics } from './client.js';
import { Subscriptions } from './datasets.js';
import { format, toUnits } from './utils/money.js';
import { monthStarts } from './utils/period.js';

/**
 * MRR on the first day of each month, per currency (never add USD to EUR).
 * Point in time: a subscription counts on day D when startedAt <= D < endsAt.
 * Cross-tenant, so it runs with `scope: 'all'`: only call it from trusted,
 * role-checked code.
 */
export async function mrrByMonth(lastPeriodId: string, months = 12) {
  const days = monthStarts(lastPeriodId, months);
  const results = await Promise.all(days.map((day) =>
    analytics.execute(Subscriptions, {
      dimensions: ['currency'],
      measures: ['mrr', 'subscriptions'],
      filters: [lte('startedAt', day), gt('endsAt', day)],
      orderBy: [{ field: 'currency', direction: 'asc' }],
    }, { runtime: { tenant: { scope: 'all' } } })));
  return days.flatMap((month, i) => results[i].data.map((row) => ({
    month,
    currency: String(row.currency),
    mrr: format(toUnits(String(row.mrr))), // Decimal(18, 4) -> cents
    subscriptions: Number(row.subscriptions),
  })));
}
