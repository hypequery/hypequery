import { createApiKeyStrategy, initServe } from '@hypequery/serve';
import { z } from 'zod';
import { DEMO_KEYS } from '../src/keys.js';
import { invoicePreview } from './billing.js';
import { db } from './client.js';
import { Usage } from './datasets.js';
import { mrrByMonth } from './mrr.js';
import { PLANS } from './pricing.js';
import { currentPeriodId } from './utils/period.js';

const { query, serve } = initServe({
  context: () => ({ db }),
  auth: createApiKeyStrategy({ validate: (key) => DEMO_KEYS[key] ?? null }),
  basePath: '/api/billing',
});

const period = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() });

/** The tenant's own projected bill. The tenant comes from the key, never the input. */
const invoicePreviewQuery = query({
  description: 'Invoice preview for the signed-in tenant: base fee, overage line items, Decimal-safe total',
  input: period,
  query: ({ ctx, input }) => invoicePreview(ctx.tenantId!, input.period ?? currentPeriodId()),
});

/** Feeds an in-app "usage this month" widget. */
const usageQuery = query({
  description: 'Billable usage against plan quotas for the signed-in tenant',
  input: period,
  query: async ({ ctx, input }) => {
    const preview = await invoicePreview(ctx.tenantId!, input.period ?? currentPeriodId());
    const quotas = PLANS[preview.plan];
    return {
      period: preview.period,
      plan: preview.plan,
      meters: (['apiCalls', 'queryRuns'] as const).map((meter) => ({
        meter,
        used: preview.usage[meter],
        included: quotas?.[meter].included ?? 0,
      })),
      projectedTotal: preview.total,
      currency: preview.currency,
    };
  },
});

/** Internal: MRR on the 1st of each month, per currency, across all tenants. */
const mrrQuery = query({
  description: 'MRR over the last 12 months, per currency (billing role only)',
  input: z.object({ through: z.string().regex(/^\d{4}-\d{2}$/).optional() }),
  requiredRoles: ['billing'],
  tenant: { required: false },
  query: ({ input }) => mrrByMonth(input.through ?? currentPeriodId()),
});

export const api = serve({
  queryBuilder: db,
  tenant: { extract: (auth) => auth.tenantId, required: true },
  queries: { invoicePreview: invoicePreviewQuery, usage: usageQuery, mrr: mrrQuery },
  datasets: {
    // Ad hoc charts for the widget, e.g. daily api calls: tenant-scoped by tenantKey.
    usage: { dataset: Usage, maxLimit: 400 },
  },
});

api.route('/invoice-preview', api.queries.invoicePreview);
api.route('/usage', api.queries.usage);
api.route('/mrr', api.queries.mrr);
