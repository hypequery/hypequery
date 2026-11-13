# SEO: next clusters after the semantic layer hub (queued 2026-11-10)

Queued behind the `/semantic-layer` hub. Volumes and difficulty are US figures
from the brief; re-pull them before starting each item. Same house rules as the
hubs: answer first, every vendor fact checked against the vendor's own page and
dated, every code sample run, an honest "when the other option is better" section.

Ranked by expected value (volume × weakness of the current results × fit):

## 1. React charting (~6,900/mo, KD 9–41). Best fit.

Embeddable ranks #4 with a "build analytics dashboards with Recharts" guide; the
rest of the page is library docs. hypequery's React hooks feeding a chart library
is a tutorial nobody else can write as well.

- **Pillar:** `/react-charts`: "React chart libraries for analytics dashboards".
  Compare Recharts, visx, Nivo, Chart.js (react-chartjs-2) and ECharts
  (echarts-for-react) on bundle size, SSR, rendering (SVG vs canvas), how much
  data each handles and TypeScript types. Targets `react charts`, `best react
  chart library`.
- **Spokes**, one per library, each a build guide with the same tenant-scoped
  dataset → Serve → `useDataset` → chart: `/react-charts/recharts` (the 4,400
  term, so write it first), `/react-charts/visx`, `/react-charts/nivo`,
  `/react-charts/chartjs`, `/react-charts/echarts`.
- **Links in:** `/clickhouse-react`, `/clickhouse-dashboard`, `/embedded-analytics`,
  React docs (`docs/(connect)/react`).
- **Check:** every guide's code runs in a scratch Next.js app against the demo
  dataset; screenshot each chart.

## 2. Row-level security (~2,100/mo, KD 0–18). Strong fit.

The results are old blogs, Reddit, Hacker News and Stack Exchange.

- **Pillar:** `/row-level-security`: what RLS is, how Postgres (`CREATE POLICY`),
  Supabase, ClickHouse (`CREATE ROW POLICY`), Power BI and Tableau do it, and
  why RLS alone isn't tenant isolation for an API (connection pooling, a shared
  service user, session variables).
- **Spokes:** `postgres row level security` (480) and `supabase row level
  security` (90) as one guide; `power bi row level security` (320) and `tableau
  row level security` (210) as embedded-angle guides ("RLS for customer-facing
  embeds"); a ClickHouse row policies guide.
- **Links in:** `/embedded-analytics` tenant section, multi-tenancy docs,
  `/clickhouse-multi-tenant-analytics`, the embedded multi-tenant blog post.
- **Check:** run every policy example on Postgres 17 and ClickHouse 26.x.

## 3. Embedded pricing (~650/mo, KD 0–8). Good fit; overlaps the existing pricing item.

Power BI Embedded pricing is live (2026-11-09). Keep each page to the embedded
angle, with a worked cost for a fixed scenario (100 customers, 10 viewers each).

- `metabase pricing` (260): Metabase embedded pricing teardown.
- `looker pricing` (170): Looker embedded pricing teardown.
- Then Cube, and one combined Luzmo "pricing and alternatives" page.
- **Links in:** `/embedded-analytics` vendor table, `/compare/hypequery-vs-metabase`,
  `/cube-js-alternative`.

## 4. "Embed X in Y" guides (10–40/mo each, KD ~0). High intent.

Volume is low, but CPC runs $70–160, so these are developers choosing how to
embed right now. Results are vendor docs and forums.

- One template, several pages: `tableau embed api` (110), `metabase embed` (70),
  `embed grafana dashboard in web application` (40), `quicksight embed dashboard`
  (30). Each covers the vendor's embed steps accurately (signed URLs, tokens,
  tenant scoping), then "or serve the same chart from your backend".
- Put them under `/embedded-analytics/` so they link up to the hub.
- Bundle with the pricing teardown for the same vendor where one exists.

## 5. Ad hoc reporting (1,900/mo, KD 0). One page.

The results are definitions from finance-software and BI vendors.

- `/ad-hoc-reporting`: definition first, then frame it as customer self-serve
  reporting: "let customers ask their own questions", leading into embedded
  analytics chat. Pairs with the embedded analytics chat definition page from the
  earlier brief, so write the two together and link them both ways.

## Order

1 → 2 → 3 → 5 (with the chat pages) → 4. Clusters 3 and 4 share vendor research,
so whoever does 3 should collect the embed-docs URLs for 4. Link-earning work from
the earlier brief runs alongside all of these.
