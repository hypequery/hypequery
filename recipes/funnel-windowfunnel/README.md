# Funnel analysis in ClickHouse with windowFunnel and a typed dataset

Count users through login, query and export within 24 hours per tenant with windowFunnel, get conversion per step, and see what each strict mode changes.

`windowFunnel(window)(timestamp, cond1, cond2, ...)` returns, per group, the deepest step a user reached in order with every step inside `window` seconds of the first. Group by user, then count users per level: that is the funnel. Across all tenants in October 2026, 1,537 users logged in, 863 (56.1%) ran a query within 24 hours of a login, and 337 (39.0% of those, 21.9% overall) went on to export. windowFunnel cannot be a hypequery measure, because it has to be aggregated per user before you count users, so the recipe puts it in a view and the dataset counts levels over that view. The mode comparison at the end is a typed raw query.

## Demo

```text
login -> query_run -> export within 24h, top tenants, 2026-10

tenant  logged in  ran query  exported  login->query  query->export  login->export
   153        141        106        50         75.2%          47.2%          35.5%
    14         99         61        20         61.6%          32.8%          20.2%
    52         98         62        27         63.3%          43.5%          27.6%
     9         80         54        21         67.5%          38.9%          26.3%
    47         73         59        34         80.8%          57.6%          46.6%
    18         71         47        26         66.2%          55.3%          36.6%
   134         57         41        17         71.9%          41.5%          29.8%
    36         51         39        23         76.5%          59.0%          45.1%
    66         39         29        20         74.4%          69.0%          51.3%
   170         33         14         0         42.4%           0.0%           0.0%

all tenants      1537        863       337         56.1%          39.0%          21.9%
```

## Install

```bash
npx @hypequery/cli create funnel-windowfunnel -y
cd funnel-windowfunnel
docker compose -f ../examples/_seed/docker-compose.yml up -d --wait && pnpm seed   # or set CLICKHOUSE_* for your own ClickHouse
pnpm install
pnpm dev
```

`pnpm dev` creates the `funnel_windowfunnel_user_levels` view, runs the query, and prints the per-tenant table, the overall row and the mode comparison.

## What it shows

- **windowFunnel once, in a view** (`sql/user-funnel.sql`): one row per tenant, user and month with `windowFunnel(86400)(occurred_at, event_type = 'login', event_type = 'query_run', event_type = 'export')`, the deepest step (0 to 3) reached within 24 hours.
- **Steps as measures** (`src/dataset.ts`): "reached step N" is `countDistinct(userId)` filtered on `funnelLevel >= N`, and the three conversion rates are derived measures, so a dashboard asks for `conversion` by name.
- **The generated SQL is asserted** (`expected.sql`): hypequery renders each step as `COUNT(DISTINCT if(funnel_level >= N, user_id, NULL))` in one pass over the view.
- **Checked against a funnel without windowFunnel** (`src/smoke.test.ts`): the test rebuilds every tenant's funnel from sorted timestamp arrays and `arrayExists`, and the counts must match exactly.
- **The strict modes, pinned** (`compareModes()` in `src/recipe.ts`): the same October funnel under every mode, with and without pre-filtering to the funnel events.

## Key file

```ts
export const query = {
  dimensions: ['tenantId'],
  measures: ['loggedIn', 'ranQuery', 'exported', 'queryRate', 'exportRate', 'conversion'],
  filters: [between('month', '2026-10-01 00:00:00', '2026-10-31 23:59:59')],
  orderBy: [{ field: 'loggedIn', direction: 'desc' }, { field: 'tenantId', direction: 'asc' }],
  limit: 10,
} satisfies DatasetQueryFor<typeof Funnel>;

const result = await analytics.execute(Funnel, query);
```

## Strict modes

The mode is the second parameter: `windowFunnel(86400, 'strict_order')(...)`. Users reaching each step, all tenants, October 2026:

| Mode | Input | Step 1 | Step 2 | Step 3 |
| --- | --- | ---: | ---: | ---: |
| default | all events | 1537 | 863 | 337 |
| `strict_order` | all events | 1537 | 178 | 6 |
| `strict_order` | funnel events only | 1537 | 635 | 244 |
| `strict_deduplication` | either | 1537 | 641 | 138 |
| `strict_increase` | either | 1537 | 863 | 337 |
| `strict_once` | either | 1537 | 863 | 337 |

- **Default**: other events between steps are ignored, and the result does not depend on which non-funnel rows you feed it.
- **`strict_order`**: any event between two steps stops the chain. On the full event stream almost nothing survives, because a page view or API call usually sits between a login and a query. What it measures depends on the rows you pass in: pre-filter to the funnel events and it means "no other funnel step in between"; leave everything in and it means "the next thing the user did".
- **`strict_deduplication`**: a repeat of the step just reached ends that chain: login, query_run, query_run, export scores 2, not 3. A repeated login does not, because it can start a fresh chain.
- **`strict_increase`**: steps need strictly increasing timestamps. Same answer here because the seed has almost no same-second events per user.
- **`strict_once`**: each event counts towards one step only. By default one event can satisfy two consecutive conditions (with steps `e IN ('a', 'b')` then `e IN ('b', 'x')`, a single `b` passes both); our three conditions are disjoint, so nothing changes.

On ClickHouse 25.8, `strict_deduplication` can also report a step that never happened inside the window: login, query_run 5 minutes later, export a day later, then another query_run returns 3 with a one-hour window, where the default mode returns 2. With the 24-hour window, 51 October users get a higher level from `strict_deduplication` than from the default mode, which should be impossible for a stricter mode. The smoke test pins this repro; check your version before trusting that mode.

## Architecture

```text
events ── VIEW funnel_windowfunnel_user_levels (tenant_id, user_id, month, funnel_level = windowFunnel(86400)(...))
                 │
                 └─ dataset loginToExportFunnel ── loggedIn / ranQuery / exported (filtered countDistinct)
                          │                         queryRate / exportRate / conversion (derived)
                 analytics.execute(Funnel, query) ──▶ output.json (asserted in CI, exact)
                 db.rawQuery(...)                  ──▶ the mode comparison (typed raw SQL)
```

## Adapt it

- **Your steps.** Each condition is any boolean expression: `event_type = 'page_view' AND path = '/pricing'` works as a step. windowFunnel takes up to 32 (33 is `Too many event arguments`).
- **Your window.** The first parameter is seconds when the timestamp is a `DateTime`. Change `86400` in the view; the dataset does not change.
- **Funnels that cross months.** The view groups by month, so a login on the 31st and an export on the 1st do not connect. Group by `toStartOfWeek` or drop the month for a rolling funnel over a filtered range.
- **Per tenant only.** Set `tenantKey: 'tenant_id'` on the dataset and every query is scoped to one tenant, which is how the embedded example serves it.
- **Drop-off per step.** Add `funnelLevel` to `dimensions` and `users: measure.countDistinct('userId')` to get the count of users whose deepest step was each level.

## Related recipes

- [retention-cohorts](../retention-cohorts): the same "shape it in a view, count it in a dataset" pattern.
- [sessionization](../sessionization): split the same event stream into sessions instead of funnels.

## Related examples

- [multi-tenant-embedded-analytics](../../examples/multi-tenant-embedded-analytics): serve a per-tenant funnel to each customer.

Versions used: ClickHouse 25.8, `@hypequery/datasets` 0.29 and `@hypequery/clickhouse` 2.14.
