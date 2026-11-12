import { desc, gt, gte, lt } from '@hypequery/datasets';
import { analytics } from './client.js';
import { Subscriptions, Usage } from './datasets.js';
import { METERS, PLANS } from './pricing.js';
import { format, roundToCents, times, toUnits } from './utils/money.js';
import { billingPeriod, type Period } from './utils/period.js';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
}

/** Billable usage for one tenant and period: the same numbers the widget shows. */
async function meteredUsage(tenantId: string, period: Period) {
  const { data } = await analytics.execute(Usage, {
    measures: ['apiCalls', 'queryRuns'],
    filters: [gte('occurredAt', period.start), lt('occurredAt', period.end)], // half-open
  }, { runtime: { tenant: tenantId } });
  return { apiCalls: Number(data[0]?.apiCalls ?? 0), queryRuns: Number(data[0]?.queryRuns ?? 0) };
}

/** Point in time: the latest subscription row that overlaps the period. */
async function subscriptionFor(tenantId: string, period: Period) {
  const { data } = await analytics.execute(Subscriptions, {
    dimensions: ['plan', 'status', 'billingInterval', 'amount', 'currency', 'startedAt'],
    measures: ['subscriptions'],
    filters: [lt('startedAt', period.end), gt('endsAt', period.start)],
    orderBy: [desc('startedAt')],
    limit: 1,
  }, { runtime: { tenant: tenantId } });
  return data[0];
}

export async function invoicePreview(tenantId: string, periodId: string) {
  const period = billingPeriod(periodId);
  const [usage, sub] = await Promise.all([meteredUsage(tenantId, period), subscriptionFor(tenantId, period)]);
  const head = { tenantId, period: period.id, periodStart: period.start, periodEnd: period.end, usage };
  if (!sub) return { ...head, plan: 'free', currency: null, lines: [] as InvoiceLine[], total: '0.00' };

  // Annual plans are charged in their anniversary month; trials pay no base fee.
  const anniversary = String(sub.startedAt).slice(5, 7) === period.id.slice(5, 7);
  const baseDue = sub.status !== 'trialing' && (sub.billingInterval === 'monthly' || anniversary);
  const note = baseDue ? '' : sub.status === 'trialing' ? ', trial' : ', prepaid';
  const lines: InvoiceLine[] = [{
    description: `${sub.plan} plan (${sub.billingInterval}${note})`,
    quantity: 1,
    unitPrice: format(toUnits(String(sub.amount))),
    amount: baseDue ? format(toUnits(String(sub.amount))) : '0.00',
  }];

  for (const meter of METERS) {
    const price = PLANS[String(sub.plan)][meter];
    const over = Math.max(0, usage[meter] - price.included);
    if (over === 0) continue;
    lines.push({
      description: `${price.label} over ${price.included} included (${usage[meter]} used)`,
      quantity: over,
      unitPrice: price.overageUnitPrice,
      amount: format(times(price.overageUnitPrice, over)),
    });
  }

  // Total = sum of the rounded lines, so it always matches what the customer reads.
  const total = lines.reduce((acc, line) => acc + roundToCents(toUnits(line.amount)), 0n);
  return { ...head, plan: String(sub.plan), currency: String(sub.currency), lines, total: format(total) };
}
