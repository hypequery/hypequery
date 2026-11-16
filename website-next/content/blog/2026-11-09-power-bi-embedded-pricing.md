---
title: "Power BI Embedded Pricing (and Cheaper Alternatives)"
description: "What Power BI Embedded costs in 2026, checked on Microsoft's own pages: A SKUs, Fabric F SKUs, the F64 licensing threshold, a worked monthly estimate for a small SaaS, and the alternatives worth pricing next to it."
seoTitle: "Power BI Embedded Pricing in 2026, and Cheaper Alternatives"
seoDescription: "Power BI Embedded A SKUs from $735.91/month, Fabric F2 from $262.80/month (US East, USD). How licensing works, a worked estimate, and cheaper alternatives."
pubDate: 2026-11-09
updatedAt: 2026-11-09
heroImage: ""
slug: power-bi-embedded-pricing
status: published
tags:
  - Embedded analytics
  - Power BI
  - Pricing
---

Power BI Embedded is billed by capacity, not by viewer: you rent a block of compute by the hour, and every embedded report your customers open runs on it. On Microsoft's pricing pages for the East US region in US dollars, checked on 9 November 2026, the smallest Azure Power BI Embedded SKU (A1) is $1.0081 an hour, or $735.91 a month if it runs all the time, and the smallest Microsoft Fabric capacity (F2), which can also serve embedded reports, is $0.36 an hour, or $262.80 a month. Add a Power BI Pro license at $14 a user per month (paid yearly) for each person who publishes reports. If you embed for your own customers ("app owns data"), the people viewing the reports need no Power BI license at all.

## Power BI Embedded pricing table

All prices are Microsoft list prices for East US in USD, read on 9 November 2026. Monthly figures are Microsoft's, based on 730 hours. Prices vary by region and currency.

### Azure Power BI Embedded (A SKUs)

Source: [Azure Power BI Embedded pricing](https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/)

| SKU | v-cores | Memory | Per hour | Per month (730 h) |
|---|---|---|---|---|
| A1 | 1 | 3 GB | $1.0081 | $735.91 |
| A2 | 2 | 5 GB | $2.0081 | $1,465.91 |
| A3 | 4 | 10 GB | $4.0242 | $2,937.67 |
| A4 | 8 | 25 GB | $8.0565 | $5,881.25 |
| A5 | 16 | 50 GB | $16.121 | $11,768.33 |
| A6 | 32 | 100 GB | $32.2506 | $23,542.94 |
| A7 | 64 | 200 GB | N/A in East US | N/A in East US |
| A8 | 128 | 400 GB | N/A in East US | N/A in East US |

The page says usage "is computed to the second and billed hourly", and that you aren't charged while the service is paused. There is no commitment.

### Microsoft Fabric capacity (F SKUs)

Source: [Microsoft Fabric pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/)

| SKU | Capacity units | Pay-as-you-go per hour | Pay-as-you-go per month | 1-year reservation per month |
|---|---|---|---|---|
| F2 | 2 | $0.36 | $262.80 | $156.33 |
| F4 | 4 | $0.72 | $525.60 | $312.67 |
| F8 | 8 | $1.44 | $1,051.20 | $625.33 |
| F16 | 16 | $2.88 | $2,102.40 | $1,250.67 |
| F32 | 32 | $5.76 | $4,204.80 | $2,501.33 |
| F64 | 64 | $11.52 | $8,409.60 | $5,002.67 |
| F128 | 128 | $23.04 | $16,819.20 | $10,005.33 |
| F256 | 256 | $46.08 | $33,638.40 | $20,010.67 |

Sizes run up to F8192, and Microsoft labels the reservation "~41% savings". Pay-as-you-go works out to $0.18 per capacity unit per hour, the same rate as the "Power BI Capacity Usage" meter in Microsoft's [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?$filter=serviceName%20eq%20'Microsoft%20Fabric'%20and%20armRegionName%20eq%20'eastus').

Microsoft's [capacity and SKUs page](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity) maps the two families: F8 is equivalent to A1, F16 to A2, F32 to A3 and F64 to A4. F2 and F4 have no A SKU equivalent. Every F SKU supports "embed for your customers".

### Power BI Premium per capacity (P and EM SKUs)

Microsoft no longer sells new P SKUs. The [Premium to Fabric migration overview](https://learn.microsoft.com/en-us/power-bi/support/premium-migration-overview) says each P SKU subscription "ends at the end of its current agreement term". Customers with an active Enterprise Agreement can renew until the agreement ends. EM and A SKUs "aren't part of this retirement". The [Premium overview](https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-what-is) says EM SKUs need a yearly commitment, and that EM1 and EM2 are sold only through volume licensing. None of the Microsoft pages I checked publish an EM price.

### Per-user licenses

Source: [Power BI pricing](https://www.microsoft.com/en-us/microsoft-fabric/features/power-bi/pricing). The same page lists Power BI Embedded as "Variable" with a "Contact sales" link.

| License | Price | Where it matters |
|---|---|---|
| Power BI Pro | $14.00 per user per month, paid yearly | Needed to publish content, and for every viewer when you embed for your organization on anything smaller than F64 |
| Premium Per User (PPU) | $24.00 per user per month, paid yearly | An alternative to Pro for those same viewers, with larger models and 48 refreshes a day |

## How the cost model works in practice

### Capacity, not seats

You pay for a capacity size, and every embedded view, query and refresh uses it. Over the CPU limit, the [Premium overview](https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-what-is) says a Power BI Embedded capacity "throttles its interactive operations": reports slow down rather than the bill going up. For A SKUs, Microsoft documents an autoscale pattern: Azure Monitor alerts trigger a runbook that calls the Capacities Update API to move up or down a SKU.

### Who needs a license

This is the rule that decides most budgets. The [capacity and SKUs page](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity) says:

- **Embed for your customers (app owns data):** "there are no licensing requirements for the end users." Your app authenticates to Power BI, usually with a service principal, and your customers never see a Power BI login.
- **Embed for your organization (user owns data), Teams, SharePoint:** on A SKUs or any F SKU below F64, "a Pro license or Premium Per User (PPU) is required for each user who will view the embedded content." At F64 and above, free users can view.
- **Publishing:** you need a Pro or PPU account to publish content, unless a service principal publishes through the REST API.

So the F64 threshold matters when you embed for staff. It doesn't matter when you embed for customers.

### Pausing

You can pause A SKUs from the portal, PowerShell or the REST API, and billing stops while they're paused. The catch is in Microsoft's own wording on the [pricing page](https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/): "When the service is paused the embedded content will not load." For a customer-facing product, pausing only helps if there are hours when nobody logs in. You can pause F SKUs too, but the [Fabric pause docs](https://learn.microsoft.com/en-us/fabric/enterprise/pause-resume) say that at pause time, remaining smoothed operations and overages "are summed, and added to your Azure bill".

### What drives the size you need

Microsoft's [capacity planning guide](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity-planning) gives no "users per SKU" figure, and the current version has no renders-per-hour table. It lists what to consider: your data models, "the number and complexity of required queries", "the hourly distribution of your application usage", and data refresh rates. The method it recommends is a load test. Use the Power BI Capacity Load Assessment Tool "with up to a few dozen concurrent simulated users and extrapolate", then watch CPU in the Fabric Capacity Metrics app. Move up a size if CPU nears the limit.

Memory sets a hard floor. From the [semantic model SKU limits](https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-what-is):

| SKU | Max memory per semantic model | Max memory per query | Live connections per second | DirectQuery connections per model |
|---|---|---|---|---|
| F2 / F4 | 3 GB | 1 GB | 2 | 5 |
| F8 (A1) | 3 GB | 1 GB | 3.75 | 10 |
| F16 (A2) | 5 GB | 2 GB | 7.5 | 10 |
| F32 (A3) | 10 GB | 5 GB | 15 | 10 |
| F64 (A4) | 25 GB | 10 GB | 30 | 50 |

A refresh can use more than twice the model's size, because the old copy keeps serving queries while the new one loads. Budget for that headroom.

### Dev/test vs production

For development, Microsoft allows "free embed trial tokens with a Pro license", which show a "Free trial version" banner. Production needs a purchased capacity. A small A SKU for staging, paused outside working hours, keeps test costs down.

## Worked example: a small SaaS embedding dashboards for customers

Assume a B2B SaaS with 300 customer users, a handful of dashboards on an imported model under 3 GB, two people building reports, and customers spread across time zones, so the capacity runs 24/7. This is the app-owns-data scenario, so customers need no licenses. All prices are East US list prices from the tables above.

**Option 1: A1, pay as you go**

- Capacity: $1.0081 × 730 hours = $735.91
- Authors: 2 × Pro at $14.00 = $28.00
- **Total: $763.91 a month**

**Option 2: F2, pay as you go (cheapest entry)**

- Capacity: $0.36 × 730 hours = $262.80
- Authors: 2 × $14.00 = $28.00
- **Total: $290.80 a month**

F2 has a quarter of F8's capacity units and 1 GB of memory per query, so load test it before customers use it.

**Option 3: F8 (the A1 equivalent) on a 1-year reservation**

- Capacity: $625.33 a month
- Authors: $28.00
- **Total: $653.33 a month**, with a year's commitment.

**If load tests push you to A2:** $1,465.91 + $28.00 = $1,493.91 a month.

**If your customers are all in one region** and you can pause A1 for 8 hours a night: $1.0081 × 16 hours × 30 days = $483.89, plus $28.00 = $511.89 a month. The cost is that the dashboards don't load for 8 hours.

None of these totals include the database behind the model, gateways, or the engineering time to build the embed flow.

For contrast, take 150 staff viewers under "embed for your organization". F32 plus Pro for every viewer is $4,204.80 + (150 × $14.00) = $6,304.80 a month. F64 with free viewers is $8,409.60 pay-as-you-go, or $5,002.67 on a 1-year reservation. There, licensing decides the size.

## Cheaper or different alternatives

Every price below was read on the vendor's own pricing page on 9 November 2026.

- **[Metabase](https://www.metabase.com/pricing?use_case=ea).** The open-source edition supports guest (view-only) embedding, per the [embedding docs](https://www.metabase.com/docs/latest/embedding/introduction). Pro is $575 a month, cloud or self-hosted, and includes 10 users, then $12 per user per month. Metabase notes that "users of your embeds" count as users. Enterprise starts at $20,000 a year. At 300 customer users on Pro: $575 + (290 × $12) = $4,055 a month. *Pick it when* you want a mature open-source BI tool, and either view-only embeds are enough or your viewer count is small.
- **[Cube](https://cube.dev/pricing).** Cube Core is open source (Apache 2.0 backend, MIT client, per the [GitHub repo](https://github.com/cube-js/cube)). On Cube Cloud, embedded dashboards start at Premium: $80 per developer per month, Viewer seats at $20 per user per month, and a dedicated deployment at $1.20 an hour. *Pick it when* you want a semantic layer and APIs in front of your warehouse and plan to draw the charts yourself.
- **[Luzmo](https://www.luzmo.com/pricing).** One plan, "starting from €1,995 per month", billed annually, with the price scaling with customer adoption. *Pick it when* you want white-label embedded dashboards built for SaaS, with self-service for your customers.
- **[Embeddable](https://embeddable.com/pricing).** A flat monthly subscription with unlimited usage. Pricing on request. *Pick it when* you want code-level control of the components and a predictable bill.
- **Apache Superset / [Preset](https://preset.io/pricing/).** Superset is Apache 2.0 and ships an [embedded SDK](https://github.com/apache/superset/tree/master/superset-embedded-sdk) that uses guest tokens. On Preset, Professional is $20 per user per month billed annually ($25 monthly). Embedding is an add-on that needs Embedded Dashboard Viewer Licenses "starting at $500/month for 50 licenses". *Pick it when* you want open-source BI with embedding, and either self-host it or pay for a managed version.
- **[Sisense](https://www.sisense.com/plans/).** Self-serve and Enterprise plans; no prices published. Pricing on request. *Pick it when* you need regulated-industry compliance, on-prem deployment, or its Compose SDK.
- **[GoodData](https://www.gooddata.ai/pricing/).** Professional is priced per workspace ("platform fee + number of workspaces") with unlimited users. Pricing on request. *Pick it when* you have many tenants with many users each and per-seat pricing would hurt.

For more vendors priced side by side, including a 1,000-viewer scenario, see [embedded analytics pricing compared](/compare/embedded-analytics-pricing).

### The code-first route

The other option is to skip the BI tool (see [build vs buy embedded analytics](/compare/build-vs-buy-embedded-analytics) for what that costs): put an API in front of your warehouse and draw the charts in your own React components. There are no viewer licenses or capacity SKUs. You pay for your database and your app servers, and you write the dashboard UI yourself. That trade is reasonable when analytics is a core product feature and your team already ships frontend code. It's a poor trade when you need non-developers to build reports.

On ClickHouse, [hypequery](/embedded-analytics) is one way to build that layer. It's an open-source TypeScript and Python library that runs in your own backend. You define semantic datasets with measures and dimensions, serve them as typed HTTP endpoints with tenant scope taken from your auth context, read them with React hooks, and expose the same datasets to agents over MCP. It doesn't draw charts or host anything. See [hypequery vs Metabase](/compare/hypequery-vs-metabase) for an honest look at when a BI tool is the better choice, and [ClickHouse multi-tenant analytics](/clickhouse-multi-tenant-analytics) for the tenant isolation patterns.

## When Power BI Embedded is the right choice

Power BI Embedded is often the sensible pick, even at these prices:

- **You're already a Microsoft shop.** Azure billing, Entra ID and an existing Microsoft agreement make procurement easy, and Fabric spend can count toward a Microsoft Azure Consumption Commitment.
- **The reports already exist.** If your analysts have built Power BI reports for internal use, embedding them for customers is mostly plumbing, not a rebuild.
- **The people writing reports aren't developers.** Power BI Desktop is free, and analysts can change a report without a code release.
- **You rely on DAX, Power Query or paginated reports.** Those are hard to replace with a custom API.
- **Your viewer count is large and spiky.** Capacity pricing doesn't charge per viewer, so at a few hundred customer users an A1 can cost less than per-user embedding plans.

It's a weaker fit when the embedded report has to look and behave like the rest of your UI, or when your data lives in ClickHouse and you'd rather not maintain a separate Power BI model on top of it.

## FAQ

### How much does Power BI Embedded cost per month?

In East US on 9 November 2026: from $735.91 a month for an always-on A1, or $262.80 for a Fabric F2, plus $14 a month (paid yearly) per Pro license for report authors.

### Do my customers need Power BI licenses to view embedded reports?

Not when you embed for your customers (app owns data). When you embed for your organization, every viewer needs Pro or PPU unless you're on F64 or larger.

### Can I pause Power BI Embedded to save money?

Yes. A SKUs stop billing while paused, but embedded content won't load, so this mainly helps dev, test and staging capacities.

### Should I buy an A SKU or an F SKU?

Pay-as-you-go, the A SKU is cheaper at the same size: A1 is $735.91 a month against $1,051.20 for F8. A 1-year F8 reservation ($625.33) beats both. F SKUs also come smaller (F2, F4) and include the other Fabric workloads.

### Is Power BI Premium per capacity still sold?

No new P SKUs are sold. Existing subscriptions run to the end of their term, and Enterprise Agreement customers can renew until the agreement ends. EM and A SKUs aren't affected.

## Sources

All checked on 9 November 2026. Prices are East US, USD, list.

- [Azure Power BI Embedded pricing](https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/)
- [Microsoft Fabric pricing](https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/)
- [Power BI pricing](https://www.microsoft.com/en-us/microsoft-fabric/features/power-bi/pricing)
- [Capacity and SKUs in Power BI embedded analytics](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity)
- [Power BI embedded analytics capacity planning](https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity-planning)
- [What is Power BI Premium?](https://learn.microsoft.com/en-us/fabric/enterprise/powerbi/service-premium-what-is)
- [Power BI Premium to Microsoft Fabric migration overview](https://learn.microsoft.com/en-us/power-bi/support/premium-migration-overview)
- [Pause and start Power BI Embedded capacity](https://learn.microsoft.com/en-us/power-bi/developer/embedded/azure-pbie-pause-start)
- [Pause and resume Fabric capacity](https://learn.microsoft.com/en-us/fabric/enterprise/pause-resume)

## Related

- [Embedded analytics for developers: build vs buy](/embedded-analytics)
- [Metabase alternative for embedded analytics](/compare/hypequery-vs-metabase)
- [Embedded analytics with ClickHouse: multi-tenant dashboards](/blog/embedded-analytics-clickhouse-multi-tenant-dashboards)
- [ClickHouse multi-tenant analytics](/clickhouse-multi-tenant-analytics)
