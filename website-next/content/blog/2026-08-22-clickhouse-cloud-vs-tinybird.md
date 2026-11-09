---
title: "Tinybird vs ClickHouse Cloud: Is Tinybird More Expensive?"
description: "Not at the entry level: Tinybird starts at $25/month, while the smallest ClickHouse Cloud service costs about $160/month in compute running around the clock. The pricing side by side, how each one bills, and where each one wins."
seoTitle: "Is Tinybird More Expensive Than ClickHouse Cloud? (2026)"
seoDescription: "Not at the entry level: Tinybird starts at $25/month; an always-on ClickHouse Cloud Basic service is about $160/month. Pricing table and when each wins."
pubDate: 2026-08-22
updatedAt: 2026-11-09
heroImage: ""
slug: clickhouse-cloud-vs-tinybird
status: published
tags:
  - ClickHouse
  - Tinybird
---

Not at the entry level. Tinybird's Developer plan starts at $25/month, and its 0.5 vCPU size costs $49/month with 25 GB of storage and hosted API endpoints included. The smallest ClickHouse Cloud service (Basic, 8 GiB of RAM and 2 vCPUs) costs about $160/month in compute if it runs around the clock, before storage. ClickHouse's own example that keeps it awake 6 hours a day comes to $66.52/month in total. For that money ClickHouse Cloud gives you four times the vCPUs of Tinybird's $49 size, and Tinybird's larger SaaS and Enterprise plans are custom-priced on 12-month credits, so beyond the smallest workloads the cheaper option depends on your hours, data and query rate.

| | Tinybird | ClickHouse Cloud |
|---|---|---|
| Free option | Free plan with no time limit: 0.25 vCPU, 1,000 requests a day, 10 GB of storage | $300 of credits for 30 days |
| Entry paid price | Developer from $25/month; the 0.5 vCPU size is $49/month with 25 GB of storage | Basic, 1 replica of 8 GiB and 2 vCPUs: $159.66/month of compute running 24/7 on AWS us-east-1, plus storage |
| How compute is billed | A plan sized in vCPUs; use above the plan is $0.0002 per vCPU-second | Per minute of active compute: $0.2181 (Basic), $0.2985 (Scale) or $0.3903 (Enterprise) per compute-unit-hour on AWS us-east-1; idle services scale to zero |
| Storage | 25 GB included on Developer, then $0.058/GB | $25.30 per TB-month of compressed data; backups at the same rate |
| Egress | $0.01/GB within a cloud, $0.10/GB between clouds | Public internet from $0.1152/GB, inter-region from $0.0312/GB |
| API hosting | Included: endpoints are the product | Query API endpoints for saved queries, or your own API service, paid separately |
| Larger plans | SaaS and Enterprise, custom-priced on credits with a 12-month commitment | Scale and Enterprise tiers, pay-as-you-go or committed spend |

Prices come from [Tinybird's pricing page](https://www.tinybird.co/pricing), the [ClickHouse Cloud pricing page](https://clickhouse.com/pricing) and the worked examples in [ClickHouse's billing docs](https://clickhouse.com/docs/cloud/manage/billing/overview), checked on 9 November 2026. Rates vary by cloud and region.

ClickHouse Cloud is the managed ClickHouse database run by ClickHouse, Inc.: a service with full SQL access over HTTPS, the native protocol and the MySQL wire protocol. Tinybird is a data platform from a separate company that runs ClickHouse underneath and adds ingestion connectors, SQL-to-REST API endpoints, access tokens and a branch-based development workflow. Pick Tinybird when what you want is hosted analytics APIs with as little backend work as possible; pick ClickHouse Cloud when your own services, jobs and BI tools need to read and write a ClickHouse database directly.

## How is Tinybird different from ClickHouse Cloud?

ClickHouse Cloud sells the database as a service, and Tinybird sells a platform built on that database. In ClickHouse Cloud you create tables, run any SQL and connect with any ClickHouse client. In Tinybird you define data sources, pipes and API endpoints as project files or with its [TypeScript SDK](https://www.tinybird.co/docs/forward/quickstarts/typescript-sdk), deploy them to a Workspace, and your application calls the hosted endpoints. Tinybird's [managed ClickHouse page](https://www.tinybird.co/product/managed-clickhouse) says it "runs native ClickHouse under the hood", and it also exposes a ClickHouse HTTP interface, which its [docs](https://www.tinybird.co/docs/forward/query-data/clickhouse-interface) describe as read-only.

| | ClickHouse Cloud | Tinybird |
|---|---|---|
| Run by | ClickHouse, Inc. | Tinybird, which states it is not affiliated with ClickHouse, Inc. |
| What you get | A managed ClickHouse service | Managed ClickHouse plus ingestion, API endpoints, tokens, Cloud Branches and Tinybird Local |
| SQL access | Read and write over HTTPS, native protocol and MySQL wire protocol ([compatibility guide](https://clickhouse.com/docs/products/cloud/guides/cloud-compatibility)) | API Endpoints and the Query API; the ClickHouse HTTP interface is read-only |
| Ingestion | ClickPipes (billed separately) or any ClickHouse insert path | Events API plus Kafka, S3, GCS and DynamoDB connectors |
| HTTP API from SQL | [Query API endpoints](https://clickhouse.com/docs/products/cloud/features/sql-console-features/query-endpoints) built from saved queries in the console | API Endpoints are the core of the product |
| Clouds and regions | AWS, Google Cloud and Azure; 38 region codes listed, 21 of them public ([regions](https://clickhouse.com/docs/products/cloud/reference/supported-regions)) | Regions on AWS and Google Cloud in its docs |
| In your own cloud account | [BYOC](https://clickhouse.com/docs/products/cloud/guides/infrastructure/deployment-options/byoc/overview), generally available on AWS, GCP and Azure, with a committed contract | [Self-managed regions](https://www.tinybird.co/docs/forward/core-concepts/self-managed), in beta and for development only |
| Free option | $300 of credits for 30 days | Free plan with no time limit |
| Billing unit | Compute-unit-hours plus TB-months of storage | Plan size in vCPUs plus overages; credits on committed plans |

## Is Tinybird more expensive than ClickHouse Cloud?

At the entry level Tinybird costs less in dollars, as the table above shows. Past that it depends on your workload, because the two bill on different units and neither publishes a like-for-like price. ClickHouse Cloud charges for compute time and stored data, so cost follows how many hours your service is awake and how much data you keep. Tinybird charges a plan fee sized in vCPUs and then overages, so cost follows the plan you need to stay inside its limits.

### How ClickHouse Cloud bills

From the [ClickHouse Cloud pricing page](https://clickhouse.com/pricing):

- Compute is metered per minute and billed per compute-unit-hour. One compute unit is 8 GiB of RAM and 2 vCPUs.
- On AWS us-east-1 the listed compute rates are $0.2181 (Basic), $0.2985 (Scale) and $0.3903 (Enterprise) per unit-hour. Rates change with cloud provider and region.
- Storage is $25.30 per TB per month in that region, metered on the compressed size of your data. Backups are billed at the same per-TB rate.
- ClickPipes ingestion and egress are extra: public internet egress starts at $0.1152/GB and inter-region egress at $0.0312/GB. Ingress is free.
- Compute scales to zero when a service is idle, so an intermittent workload stops paying for compute between queries. The cost of that is latency: a paused service has to wake before it answers, and ClickHouse's [idling docs](https://clickhouse.com/docs/products/cloud/features/autoscaling/idling) don't recommend it for frequently used customer-facing features.
- New organizations get $300 in credits for 30 days, then move to pay-as-you-go. The pricing page lists no permanent free tier.

### How Tinybird bills

From Tinybird's [pricing page](https://www.tinybird.co/pricing) and [plan docs](https://www.tinybird.co/docs/forward/pricing):

- The Free plan gives 0.25 vCPU, 1,000 requests per day, 10 GB of storage and one query thread, with no time limit. Requests over the burst limit get HTTP 429.
- Developer plans are a fixed monthly fee by size. The pricing page says they start at $25/month and lists the 0.5 vCPU size at $49/month; the plan docs name sizes from S-1/4 (a quarter vCPU) upward. Every size includes 25 GB of storage. Extra storage is $0.058/GB and vCPU use above the plan is $0.0002 per second. Self-service sizes go up to 8 vCPUs.
- SaaS plans run on shared infrastructure from 4 vCPUs, use credits with a 12-month minimum commitment, and bill active minutes, queries per second and storage overages.
- Enterprise plans give you a dedicated ClickHouse cluster with at least 1 TB of storage, also on credits with a 12-month commitment.
- Every plan includes unlimited tables, pipes and endpoints, so hosting the API is part of the fee.

### What decides which one costs less

Tinybird's own FAQ answers the question directly: "For production workloads, it's usually cheaper", on the grounds that it replaces separate ingestion, API and operations work. That is the vendor's claim, so test it against your numbers. The factors that move the result:

- An always-on workload pays ClickHouse Cloud for every hour of compute; an intermittent one benefits from idling. Tinybird's Developer fee is the same either way.
- With ClickHouse Cloud you also pay for wherever your API runs, unless Query API endpoints are enough. Tinybird's fee already covers endpoint hosting.
- For a side project, Tinybird's Free plan costs nothing for as long as you stay inside its limits, while ClickHouse Cloud's trial ends after 30 days or $300, whichever comes first.

Both vendors have estimators: the calculator on the [ClickHouse Cloud pricing page](https://clickhouse.com/pricing) and "Estimate your price" on [Tinybird's pricing page](https://www.tinybird.co/pricing). Put the same data volume and query rate into both before deciding on price.

## Is Tinybird better than ClickHouse?

Tinybird runs ClickHouse, so the useful question is whether its platform layer is better for you than talking to ClickHouse directly. Tinybird is the better choice when hosted endpoints and managed ingestion are most of the work, and ClickHouse Cloud is better when you need the database itself.

Where Tinybird wins:

- A SQL pipe becomes a hosted API endpoint with scoped tokens, without an application server in between.
- Ingestion is built in: the Events API and connectors for Kafka, S3, GCS and DynamoDB.
- The development loop is complete: [Tinybird Local](https://www.tinybird.co/docs/forward/core-concepts/tinybird-local) runs the platform in a container for development, testing and CI, Cloud Branches give shared environments, and the TypeScript and Python SDKs define data sources and endpoints in code.
- The Free plan has no time limit, which suits prototypes and low-traffic features.

Where ClickHouse Cloud wins:

- Any ClickHouse client, BI tool or job can read and write with full SQL. Tinybird's ClickHouse interface is read-only, so writes go through its ingestion paths.
- It covers more ground: AWS, Google Cloud and Azure, with BYOC generally available on all three. Tinybird's self-managed regions are in beta, and its docs say to avoid production workloads on them.
- Idle services stop paying for compute.
- Your DDL uses standard MergeTree engines (Cloud substitutes its SharedMergeTree engine behind the scenes), so the same schema runs on open-source ClickHouse or another host if you move.

## Tinybird vs ClickHouse Cloud: which one should I pick?

Pick Tinybird if:

- The deliverable is analytics APIs, and nobody on the team wants to build and run the serving layer.
- Data arrives from Kafka, S3, GCS, DynamoDB or HTTP events and you want the platform to handle ingestion.
- SQL-focused developers own the analytics, and branches plus a local container fit how they work.
- Consumers only need to read through endpoints or the read-only ClickHouse interface.

Pick ClickHouse Cloud if:

- Services, notebooks, jobs and BI tools all need direct read and write access to ClickHouse.
- Analytics logic should live in your application code and deploy with it, behind your existing auth.
- You need Azure, a specific region, or BYOC for data residency.
- The workload is intermittent enough that scale-to-zero matters, or large enough that you want to tune compute directly.

## Should we use Tinybird in production?

Yes, if your workload fits the plan limits: Tinybird sells its paid plans for production, and its plan docs list SOC 2 Type II and HIPAA compliance on all plans. The limits worth checking before you commit, all from the [plan docs](https://www.tinybird.co/docs/forward/pricing):

- The Free plan's vCPU limit is hard, and requests over the burst capacity return HTTP 429.
- Developer plans can burst above their vCPU size (3x on the smallest sizes, 2x from S-4 up), and requests beyond the burst also return HTTP 429.
- Each organization is tied to one region; workspaces in another region need a separate organization and plan.
- Self-managed regions are beta and meant for development environments only.

## What are the alternatives to Tinybird, including open source?

The closest alternative is a managed ClickHouse service with your own API layer on top: ClickHouse Cloud, or one of the other hosts in our [comparison of managed ClickHouse services](/blog/managed-clickhouse-services-compared). If you want open source, ClickHouse itself is Apache-2.0 and you can self-host it. Tinybird Local is a development and CI container whose prerequisites include a Tinybird account, so it can't stand in for a self-hosted deployment. If what you liked about Tinybird is turning SQL into HTTP endpoints, ClickHouse Cloud's Query API endpoints do that for saved queries in the console. If you want typed analytics endpoints defined in your own code and served from your own backend, [hypequery](/tinybird-alternative) is an open-source (Apache 2.0) TypeScript and Python layer that runs against any ClickHouse, including ClickHouse Cloud; the [hypequery vs Tinybird comparison](/compare/hypequery-vs-tinybird) covers the trade-offs. It is our product, and it does not ingest data or host anything for you, which Tinybird does.

## TypeScript client for ClickHouse Cloud

The official TypeScript client for ClickHouse Cloud is [`@clickhouse/client`](https://clickhouse.com/docs/integrations/language-clients/js/index) for Node.js, with `@clickhouse/client-web` for browsers and Cloudflare Workers. It talks to ClickHouse over HTTPS (port 8443 on Cloud), using the URL, username and password from the **Connect** dialog in the Cloud console.

```typescript
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_URL!, // https://<service>.<region>.<provider>.clickhouse.cloud:8443
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const result = await client.query({
  query: `
    SELECT event_name, count() AS events
    FROM events
    WHERE tenant_id = {tenant:String} AND occurred_at >= {from:DateTime}
    GROUP BY event_name
    ORDER BY events DESC
  `,
  query_params: { tenant: 'acme', from: '2026-11-01 00:00:00' },
  format: 'JSONEachRow',
  clickhouse_settings: { output_format_json_quote_64bit_integers: 1 },
});

const rows = await result.json<{ event_name: string; events: string }>();
```

`count()` returns a UInt64, which can exceed `Number.MAX_SAFE_INTEGER`, so the example asks ClickHouse to send 64-bit integers as strings. Set it explicitly: on ClickHouse 26.6 the default is unquoted. With the setting on, the query above returns rows like this (checked on ClickHouse 26.6 with four sample events):

```text
{"event_name":"signup","events":"2"}
{"event_name":"login","events":"1"}
```

The client gives you transport, but you write the row types by hand. [hypequery](/clickhouse-typescript) adds a typed query builder on top: in Node.js it uses `@clickhouse/client` under the hood, generates TypeScript types from your live ClickHouse Cloud schema, and checks table names, columns, filters and result shapes at compile time.

```bash
npm install @hypequery/clickhouse
npm install -D @hypequery/cli
npx hypequery generate   # reads CLICKHOUSE_URL, CLICKHOUSE_USERNAME, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE
```

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const rows = await db
  .table('events')
  .select(['event_name'])
  .count('event_id', 'events')
  .where('tenant_id', 'eq', 'acme')
  .where('occurred_at', 'gte', '2026-11-01 00:00:00')
  .groupBy(['event_name'])
  .orderBy('events', 'DESC')
  .execute();
// rows: { event_name: string; events: string }[]
```

hypequery quotes 64-bit integers by default, so `events` is typed and delivered as a string. When a query needs to be an HTTP endpoint, `@hypequery/serve` exposes it with input validation, docs and OpenAPI; the [quick start](/docs/quick-start) covers both steps. That gives you the Tinybird-style "query as an endpoint" result while the endpoint runs in your own application.

If you are on Tinybird, Tinybird documents [connecting `@clickhouse/client`](https://www.tinybird.co/docs/forward/guides/connect-clickhouse-js) to its ClickHouse interface with a workspace token, so the official client also works for reads there.

## Related

- [Managed ClickHouse services compared](/blog/managed-clickhouse-services-compared)
- [ClickHouse with TypeScript](/clickhouse-typescript)
- [hypequery quick start](/docs/quick-start)
- [Building an API on ClickHouse](/clickhouse-api)
- [Real-time analytics on ClickHouse](/clickhouse-real-time-analytics)
- [ClickHouse Cloud pricing](https://clickhouse.com/pricing) and [Tinybird pricing](https://www.tinybird.co/pricing)
- [ClickHouse JavaScript client docs](https://clickhouse.com/docs/integrations/language-clients/js/index)
- [Tinybird ClickHouse interface](https://www.tinybird.co/docs/forward/query-data/clickhouse-interface)
