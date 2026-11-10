# Usage-based billing on ClickHouse: metering, invoice previews and MRR

Meter per-tenant usage in ClickHouse and turn it into Decimal-exact invoice previews, a usage-this-month API and MRR, from one TypeScript definition.

This is the runnable companion to [How to Build Usage-Based Billing with ClickHouse and TypeScript](https://hypequery.com/blog/usage-based-billing-clickhouse-typescript).

## Demo

```text
$ curl -s 'localhost:3000/api/billing/invoice-preview?period=2026-09' -H 'authorization: Bearer demo-relay-works'
{
  "tenantId": "170", "period": "2026-09", "periodStart": "2026-09-01", "periodEnd": "2026-10-01",
  "usage": { "apiCalls": 321, "queryRuns": 187 },
  "plan": "growth", "currency": "USD",
  "lines": [
    { "description": "growth plan (monthly)",                   "quantity": 1,   "unitPrice": "199.00", "amount": "199.00" },
    { "description": "API calls over 150 included (321 used)",  "quantity": 171, "unitPrice": "0.025",  "amount": "4.28" },
    { "description": "Query runs over 100 included (187 used)", "quantity": 87,  "unitPrice": "0.05",   "amount": "4.35" }
  ],
  "total": "207.63"
}

$ pnpm invoices -- 2026-10      # the billing job, in-process, same definitions
tenant 153 · enterprise · 2026-10
  enterprise plan (monthly)                          1 x  999.00 =    999.00
  API calls over 2000 included (4410 used)        2410 x  0.0125 =     30.13
  Query runs over 1000 included (2661 used)       1661 x   0.025 =     41.53
  total                                                                1070.66 EUR
```

Relay Works upgraded from starter to growth on 2026-09-20, so September bills on the growth row. Every number above is pinned in the smoke test and reconciled with a raw ClickHouse query.

## Install

```bash
npx @hypequery/cli create usage-based-billing -y
cd usage-based-billing
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

The API listens on http://localhost:3000/api/billing, with OpenAPI docs at `/api/billing/docs` (send a tenant key: the global tenant requirement covers the docs routes too). Demo API keys live in `src/keys.ts`: `demo-relay-works`, `demo-quartz-metrics` and `demo-helix-analytics` are tenants, `demo-finance` is an internal billing user.

## What it shows

- **Usage defined once** (`analytics/datasets.ts`): a `Usage` dataset over `events` with `apiCalls` and `queryRuns` measures. The invoice preview, the usage widget endpoint and the billing job (`src/run-invoices.ts`) all execute it, so the invoice and the dashboard cannot disagree.
- **Point-in-time plan lookup** (`analytics/billing.ts`): the subscription row that overlaps the billing period (`startedAt < end`, `endsAt > start`, latest first), so mid-month upgrades and cancellations bill on the right row. Periods are half-open calendar months in UTC.
- **Pricing in code, money without floats** (`analytics/pricing.ts`, `analytics/utils/money.ts`): included quotas and overage prices are decimal strings; arithmetic is BigInt in 1/10,000 units, each line rounds half away from zero, and the total is the sum of the rounded lines.
- **Tenant-scoped, fail closed** (`analytics/api.ts`): the tenant comes from the API key, never the request; `tenantKey` on both datasets makes hypequery inject `tenant_id = ?` and reject explicit tenant filters with a 400.
- **MRR over time** (`analytics/mrr.ts`): a `mrr` measure on `Subscriptions` (annual rows divided by 12, trials excluded), evaluated on the 1st of each month and grouped by currency. Cross-tenant, so only the `billing` role can call it.

## Key file

`analytics/billing.ts` turns metered usage and the active subscription into line items:

```ts
export async function invoicePreview(tenantId: string, periodId: string) {
  const period = billingPeriod(periodId);
  const [usage, sub] = await Promise.all([meteredUsage(tenantId, period), subscriptionFor(tenantId, period)]);
  const head = { tenantId, period: period.id, periodStart: period.start, periodEnd: period.end, usage };
  if (!sub) return { ...head, plan: 'free', currency: null, lines: [] as InvoiceLine[], total: '0.00' };

  // Annual plans are charged in their anniversary month; trials pay no base fee.
  const anniversary = String(sub.startedAt).slice(5, 7) === period.id.slice(5, 7);
  const baseDue = sub.status !== 'trialing' && (sub.billingInterval === 'monthly' || anniversary);
  const lines: InvoiceLine[] = [/* base fee from the subscription row */];

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

  const total = lines.reduce((acc, line) => acc + roundToCents(toUnits(line.amount)), 0n);
  return { ...head, plan: String(sub.plan), currency: String(sub.currency), lines, total: format(total) };
}
```

`meteredUsage` is one dataset query, scoped by the runtime tenant:

```ts
analytics.execute(Usage, {
  measures: ['apiCalls', 'queryRuns'],
  filters: [gte('occurredAt', period.start), lt('occurredAt', period.end)],
}, { runtime: { tenant: tenantId } });
```

## Architecture

```text
in-app widget / customer             your server (Hono + @hypequery/serve)                      ClickHouse
───────────────────────              ──────────────────────────────────────────────            ──────────
GET /api/billing/usage          ─┐
GET /api/billing/invoice-preview ├─▶ api key ─▶ tenantId ─▶ invoicePreview(tenant, period)
POST /api/billing/datasets/usage ┘                           ├─ Usage dataset      ─▶ events        (tenant_id = ?)
                                                            ├─ Subscriptions      ─▶ subscriptions (point in time)
                                                            └─ PLANS + money.ts (BigInt, no floats)
finance (role: billing)
GET /api/billing/mrr            ───▶ mrrByMonth()  scope: 'all' ─▶ subscriptions, per currency
billing job: pnpm invoices      ───▶ invoicePreview() in-process, same definitions
```

## Adapt it

- **Push usage to a billing engine.** Keep ClickHouse as the source of truth for quantities and let Stripe metered billing, Orb, Lago or Metronome rate and collect. A nightly job calls `meteredUsage` per tenant for the closed period and reports the totals (Stripe: a meter event per customer; Orb and Lago: an ingest event). Send absolute period totals with an idempotency key such as `${tenantId}:${period}:${meter}`, so a retried job can never double-bill.
- **Idempotent ingestion.** ClickHouse stores duplicates happily. Give each usage event a deterministic id at the producer and write it to a `ReplacingMergeTree` keyed on that id, then set `rowResolution` on the dataset to read with `FINAL`; or dedupe upstream before insert.
- **Late events.** Close a period after a grace window (for example 72 hours), persist the line items in your transactional database, and never recompute a closed invoice. Events that land later belong on the next invoice as an adjustment line: add an `ingested_at` column and select them by that, not by `occurred_at`.
- **Rollups.** Scanning raw events per invoice is fine at seed scale. At billions of rows, roll usage up per tenant, meter and day with a materialized view and point the `Usage` dataset at the rollup with `measure.sum`; see [materialized-view-rollups](../materialized-view-rollups). The invoice code does not change.
- **Rating rules.** Tiered or volume pricing, commitments, credits and proration are a change to `PLANS` and the loop in `billing.ts`. Tax and payment collection belong in the billing engine.
- **Real auth.** Replace the demo keys in `src/keys.ts` with your session (`fromContext`) or signed tokens, as in [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics).

## Related recipes

- [p95-latency](../../recipes/p95-latency): another tenant-aware measure over the same `events` table.

## Related examples

- [materialized-view-rollups](../materialized-view-rollups): pre-aggregate events so metering stays cheap at any volume.
- [multi-tenant-embedded-analytics](../multi-tenant-embedded-analytics): signed tokens and an embeddable widget for the usage page.

Tested on ClickHouse 25.8 with `@hypequery/clickhouse` 2.14, `@hypequery/serve` 0.24, `@hypequery/datasets` 0.29 and Hono 4.
