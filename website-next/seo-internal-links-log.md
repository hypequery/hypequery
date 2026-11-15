# Internal linking log

Weekly internal-linking passes, driven by Google Search Console. Each pass: for every page, its best queries
(position 1–10, decent impressions) become its anchors; published posts link to them where the text already says
so. Rules: 3–5 new links per post at most, body text only (no headings, intro paragraph or existing links), no
self-links, each target once per post, no rewritten sentences, priority to targets at positions 4–15.

To revert one link, replace the `After` text with the `Before` text in that file. To revert a whole pass, revert
its commit.

## 2026-11-15

GSC window 2026-08-12 to 2026-11-12 (3 months). 32 links in 22 posts, approved before editing.
Not targeted this pass, by the owner's choice: `/clickhouse/functions/*` pages and the toStartOfInterval post
(low-quality traffic).

| # | File | Anchor | Target | Target query, position |
|---|---|---|---|---|
| 1 | `content/blog/2026-05-18-typescript-vs-dbt-clickhouse.md` | a query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 2 | `content/blog/2026-05-18-typescript-vs-dbt-clickhouse.md` | ClickHouse materialized views | /blog/a-guide-to-materialized-views-in-clickhouse | clickhouse materialized view, 7.8 |
| 3 | `content/blog/2026-04-25-clickhouse-prewhere-vs-where.md` | ReplacingMergeTree | /blog/clickhouse-final-replacingmergetree-typescript | clickhouse final keyword, 6.9 |
| 4 | `content/blog/2026-04-30-embedded-analytics-clickhouse-multi-tenant-dashboards.md` | API layer | /clickhouse-api | clickhouse api, 9.2 |
| 5 | `content/blog/2026-04-25-hypequery-vs-drizzle.md` | PREWHERE | /blog/clickhouse-prewhere-vs-where | clickhouse prewhere, 8.0 |
| 6 | `content/blog/2026-04-25-hypequery-vs-drizzle.md` | ARRAY JOIN | /blog/clickhouse-array-join-typescript | array join clickhouse, 8.9 |
| 7 | `content/blog/2026-04-25-hypequery-vs-drizzle.md` | An ORM | /clickhouse-orm | clickhouse orm, 5.2 |
| 8 | `content/blog/2026-06-23-introducing-hypequery-datasets.md` | semantic layer | /clickhouse-semantic-layer | clickhouse semantic layer, 4.5 |
| 9 | `content/blog/2026-06-23-introducing-hypequery-datasets.md` | ClickHouse materialized views | /blog/a-guide-to-materialized-views-in-clickhouse | clickhouse materialized view, 7.8 |
| 10 | `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md` | Cube | /compare/hypequery-vs-cube | cube clickhouse, 9.5 |
| 11 | `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md` | Incremental materialized views | /blog/a-guide-to-materialized-views-in-clickhouse | clickhouse materialized view, 7.8 |
| 12 | `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md` | text-to-SQL | /blog/text-to-sql-vs-semantic-layer | new page (text to sql, 590/mo) |
| 13 | `content/blog/2026-11-08-managed-clickhouse-services-compared.md` | API layer | /clickhouse-api | clickhouse api, 9.2 |
| 14 | `content/blog/2026-04-25-hypequery-vs-cube.md` | Metabase | /compare/hypequery-vs-metabase | typescript vs metabase, 6.5 |
| 15 | `content/blog/2026-04-25-hypequery-vs-tinybird.md` | the query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 16 | `content/blog/2026-06-09-clickhouse-limit-by-typescript.md` | Kysely | /compare/hypequery-vs-kysely | kysely clickhouse, 3.9 |
| 17 | `content/blog/2026-06-09-clickhouse-limit-by-typescript.md` | `PREWHERE` | /blog/clickhouse-prewhere-vs-where | clickhouse prewhere, 8.0 |
| 18 | `content/blog/2026-10-07-introducing-hypequery-python.md` | semantic layer | /clickhouse-semantic-layer | clickhouse semantic layer, 4.5 |
| 19 | `content/blog/2026-06-10-query-builder-vs-orm-clickhouse.md` | Drizzle | /compare/hypequery-vs-drizzle | drizzle clickhouse, 7.7 |
| 20 | `content/blog/2026-04-14-hypequery-vs-clickhouse-client.md` | a query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 21 | `content/blog/2026-04-14-hypequery-vs-clickhouse-client.md` | `PREWHERE` | /blog/clickhouse-prewhere-vs-where | clickhouse prewhere, 8.0 |
| 22 | `content/blog/2026-07-03-add-clickhouse-analytics-nodejs-backend.md` | Drizzle | /compare/hypequery-vs-drizzle | drizzle clickhouse, 7.7 |
| 23 | `content/blog/2026-05-28-clickhouse-group-by-typescript.md` | ReplacingMergeTree | /blog/clickhouse-final-replacingmergetree-typescript | clickhouse final keyword, 6.9 |
| 24 | `content/blog/2026-11-08-clickhouse-schema-design-for-application-developers.md` | the query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 25 | `content/blog/2026-04-14-clickhouse-typescript-type-problem.md` | the query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 26 | `content/blog/2026-07-01-does-prisma-support-clickhouse.md` | a query builder | /clickhouse-query-builder | clickhouse query builder, 7.2 |
| 27 | `content/blog/2026-07-01-does-prisma-support-clickhouse.md` | `FINAL` | /blog/clickhouse-final-replacingmergetree-typescript | clickhouse final keyword, 6.9 |
| 28 | `content/blog/2026-07-01-does-prisma-support-clickhouse.md` | `PREWHERE` | /blog/clickhouse-prewhere-vs-where | clickhouse prewhere, 8.0 |
| 29 | `content/blog/2026-08-11-migrating-moosestack-to-hypequery.md` | `PREWHERE` | /blog/clickhouse-prewhere-vs-where | clickhouse prewhere, 8.0 |
| 30 | `content/blog/2025-07-23-type-safe-schema-management-clickhouse.md` | ReplacingMergeTree | /blog/clickhouse-final-replacingmergetree-typescript | clickhouse final keyword, 6.9 |
| 31 | `content/blog/2026-07-10-usage-based-billing-clickhouse-typescript.md` | semantic layer | /clickhouse-semantic-layer | clickhouse semantic layer, 4.5 |
| 32 | `content/blog/2026-11-15-clickhouse-ai-chat-vercel-ai-sdk.md` | Text-to-SQL | /blog/text-to-sql-vs-semantic-layer | new page (text to sql, 590/mo) |

### Before / after

**1.** `content/blog/2026-05-18-typescript-vs-dbt-clickhouse.md`

- Before: …A TypeScript analytics layer — whether that's raw `@clickhouse/client`, a query builder like hypequery, or a custom abstraction — handles a different job: **query execution at runtime**.…
- After: …A TypeScript analytics layer — whether that's raw `@clickhouse/client`, [a query builder](/clickhouse-query-builder) like hypequery, or a custom abstraction — handles a different job: **query execution a…

**2.** `content/blog/2026-05-18-typescript-vs-dbt-clickhouse.md`

- Before: …s dbt. Many TypeScript teams handle their transformation logic directly — using ClickHouse materialized views, scheduled queries, or application-level aggregations instead of dbt models.…
- After: …dbt. Many TypeScript teams handle their transformation logic directly — using [ClickHouse materialized views](/blog/a-guide-to-materialized-views-in-clickhouse), scheduled queries, or application-level aggregations instead of dbt models.…

**3.** `content/blog/2026-04-25-clickhouse-prewhere-vs-where.md`

- Before: …ee tables.** PREWHERE is only available on MergeTree family engines (MergeTree, ReplacingMergeTree, AggregatingMergeTree, etc.). It's silently ignored or errors on other engines.…
- After: …e tables.** PREWHERE is only available on MergeTree family engines (MergeTree, [ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript), AggregatingMergeTree, etc.). It's silently ignored or errors on other engines.…

**4.** `content/blog/2026-04-30-embedded-analytics-clickhouse-multi-tenant-dashboards.md`

- Before: …session, never from request input. Apply the tenant filter in one place in your API layer, and add a ClickHouse row policy underneath so a bug in application code still cannot read another tenan…
- After: …ession, never from request input. Apply the tenant filter in one place in your [API layer](/clickhouse-api), and add a ClickHouse row policy underneath so a bug in application code still cannot…

**5.** `content/blog/2026-04-25-hypequery-vs-drizzle.md`

- Before: …- Different SQL dialect — PREWHERE, [ARRAY JOIN](/blog/clickhouse-array-join-typescript), materialized views, dictionaries…
- After: …- Different SQL dialect — [PREWHERE](/blog/clickhouse-prewhere-vs-where), [ARRAY JOIN](/blog/clickhouse-array-join-typescript), materialized views, dictionarie…

**6.** `content/blog/2026-04-25-hypequery-vs-drizzle.md`

- Before: …- Different SQL dialect — PREWHERE, ARRAY JOIN, materialized views, dictionaries…
- After: …- Different SQL dialect — PREWHERE, [ARRAY JOIN](/blog/clickhouse-array-join-typescript), materialized views, dictionaries…

**7.** `content/blog/2026-04-25-hypequery-vs-drizzle.md`

- Before: …An ORM built for Postgres, even a lightweight one like Drizzle, is built around the relational model. ClickHous…
- After: …[An ORM](/clickhouse-orm) built for Postgres, even a lightweight one like Drizzle, is built around the relationa…

**8.** `content/blog/2026-06-23-introducing-hypequery-datasets.md`

- Before: …A semantic layer fixes that by putting a stable contract between physical tables and their consumers. Existing semantic-layer produc…
- After: …A [semantic layer](/clickhouse-semantic-layer) fixes that by putting a stable contract between physical tables and their consumers. E…

**9.** `content/blog/2026-06-23-introducing-hypequery-datasets.md`

- Before: …tasets are not a data transformation framework, a BI tool, or a replacement for ClickHouse materialized views. Cross-dataset derived metrics and derived-from-derived metrics are not part of the current public surface. The goal is a small, explicit…
- After: …asets are not a data transformation framework, a BI tool, or a replacement for [ClickHouse materialized views](/blog/a-guide-to-materialized-views-in-clickhouse). Cross-dataset derived metrics and derived-from-derived metrics are not part of the cu…

**10.** `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md`

- Before: …**Cube** is the most API-forward option and was named a Leader in the 2025 GigaOm Radar for semantic layers. It offers RES…
- After: …**[Cube](/compare/hypequery-vs-cube)** is the most API-forward option and was named a Leader in the 2025 GigaOm Radar for s…

**11.** `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md`

- Before: …deployment can sustain over a billion rows per second in ingestion throughput. Incremental materialized views fire on INSERT, enabling a natural architecture: raw events flow in, materialized views pre-aggregate into rollup tables, and fast API rea…
- After: …deployment can sustain over a billion rows per second in ingestion throughput. [Incremental materialized views](/blog/a-guide-to-materialized-views-in-clickhouse) fire on INSERT, enabling a natural architecture: raw events flow in, materialized view…

**12.** `content/blog/2026-02-09-the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases.md`

- Before: …The push toward AI-driven analytics has exposed a fundamental fragility in text-to-SQL approaches.…
- After: …The push toward AI-driven analytics has exposed a fundamental fragility in [text-to-SQL](/blog/text-to-sql-vs-semantic-layer) approaches.…

**13.** `content/blog/2026-11-08-managed-clickhouse-services-compared.md`

- Before: …osted endpoints, Tinybird or ClickHouse Cloud's Query API endpoints save you an API layer.…
- After: …sted endpoints, Tinybird or ClickHouse Cloud's Query API endpoints save you an [API layer](/clickhouse-api).…

**14.** `content/blog/2026-04-25-hypequery-vs-cube.md`

- Before: …framework consumption**: the same metric definition can be consumed by Tableau, Metabase, a custom React dashboard, and a REST API simultaneously. BI tools connect through a Postgres-compatible SQL API…
- After: …ramework consumption**: the same metric definition can be consumed by Tableau, [Metabase](/compare/hypequery-vs-metabase), a custom React dashboard, and a REST API simultaneously. BI tools connect through a P…

**15.** `content/blog/2026-04-25-hypequery-vs-tinybird.md`

- Before: …imit` middleware from `@hypequery/serve`, and an optional query result cache in the query builder, where you need them…
- After: …mit` middleware from `@hypequery/serve`, and an optional query result cache in [the query builder](/clickhouse-query-builder), where you need them…

**16.** `content/blog/2026-06-09-clickhouse-limit-by-typescript.md`

- Before: …ist in standard SQL, so query builders designed around the common denominator — Kysely, Knex, and the ORM query APIs — have no method for it. Your options there are a raw SQL fragment or restructuring the…
- After: …st in standard SQL, so query builders designed around the common denominator — [Kysely](/compare/hypequery-vs-kysely), Knex, and the ORM query APIs — have no method for it. Your options there are a raw SQ…

**17.** `content/blog/2026-06-09-clickhouse-limit-by-typescript.md`

- Before: …with ClickHouse: the features that make it worth choosing (`LIMIT BY`, `FINAL`, `PREWHERE`, `argMax`, `arrayJoin`) are exactly the ones generic tools omit. hypequery's builder is ClickHouse-only by design, so these…
- After: …ith ClickHouse: the features that make it worth choosing (`LIMIT BY`, `FINAL`, [`PREWHERE`](/blog/clickhouse-prewhere-vs-where), `argMax`, `arrayJoin`) are exactly the ones generic tools omit. hypequery's builder i…

**18.** `content/blog/2026-10-07-introducing-hypequery-python.md`

- Before: …by, or how to keep one customer's data away from another. That is the job of a semantic layer, and we think it belongs in your codebase rather than in YAML files or a separate server.…
- After: …by, or how to keep one customer's data away from another. That is the job of a [semantic layer](/clickhouse-semantic-layer), and we think it belongs in your codebase rather than in YAML files or a separate serv…

**19.** `content/blog/2026-06-10-query-builder-vs-orm-clickhouse.md`

- Before: …o Prisma for ClickHouse": the entity model at the heart of Prisma, TypeORM, and Drizzle's relational layer assumes row-level transactional semantics that ClickHouse intentionally doesn't have. Prisma has no…
- After: …Prisma for ClickHouse": the entity model at the heart of Prisma, TypeORM, and [Drizzle](/compare/hypequery-vs-drizzle)'s relational layer assumes row-level transactional semantics that ClickHouse intention…

**20.** `content/blog/2026-04-14-hypequery-vs-clickhouse-client.md`

- Before: …2. a query builder that enforces that schema at compile time…
- After: …2. [a query builder](/clickhouse-query-builder) that enforces that schema at compile time…

**21.** `content/blog/2026-04-14-hypequery-vs-clickhouse-client.md`

- Before: …possible ClickHouse expression.** It does cover ClickHouse-native work such as `PREWHERE`, `FINAL`, `LIMIT BY`, array joins, CTEs, settings, percentiles, and `argMax`. Window expressions use `selectExpr()`, and hi…
- After: …possible ClickHouse expression.** It does cover ClickHouse-native work such as [`PREWHERE`](/blog/clickhouse-prewhere-vs-where), `FINAL`, `LIMIT BY`, array joins, CTEs, settings, percentiles, and `argMax`. Window e…

**22.** `content/blog/2026-07-03-add-clickhouse-analytics-nodejs-backend.md`

- Before: …Your ORM can't help here. Prisma and Drizzle have no native ClickHouse driver, and TypeORM's entity model doesn't fit a columnar, append-heavy database (more in [C…
- After: …Your ORM can't help here. Prisma and [Drizzle](/compare/hypequery-vs-drizzle) have no native ClickHouse driver, and TypeORM's entity model doesn't fit a columnar, a…

**23.** `content/blog/2026-05-28-clickhouse-group-by-typescript.md`

- Before: …" without a self-join — and it's also the standard workaround for deduplicating ReplacingMergeTree data without paying the `FINAL` cost.…
- After: …without a self-join — and it's also the standard workaround for deduplicating [ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript) data without paying the `FINAL` cost.…

**24.** `content/blog/2026-11-08-clickhouse-schema-design-for-application-developers.md`

- Before: …query/cli generate --output ./src/schema.ts` writes an `IntrospectedSchema` for the query builder and a record type per table. For the `events` table:…
- After: …uery/cli generate --output ./src/schema.ts` writes an `IntrospectedSchema` for [the query builder](/clickhouse-query-builder) and a record type per table. For the `events` table:…

**25.** `content/blog/2026-04-14-clickhouse-typescript-type-problem.md`

- Before: …n `npx hypequery generate`. It introspects your tables and writes a schema file the query builder uses to type every query's columns, filters and results. See [the fix](#the-fix-generate-types-from-the-live-schem…
- After: …`npx hypequery generate`. It introspects your tables and writes a schema file [the query builder](/clickhouse-query-builder) uses to type every query's columns, filters and results. See [the fix](#the-fix-genera…

**26.** `content/blog/2026-07-01-does-prisma-support-clickhouse.md`

- Before: …a feature to its analytics-side equivalent honestly, including the places where a query builder deliberately isn't an ORM.…
- After: …feature to its analytics-side equivalent honestly, including the places where [a query builder](/clickhouse-query-builder) deliberately isn't an ORM.…

**27.** `content/blog/2026-07-01-does-prisma-support-clickhouse.md`

- Before: …y happens to execute, you can't express the things you moved to ClickHouse for: `FINAL` on a `ReplacingMergeTree`, `LIMIT BY` for top-N-per-group, [`PREWHERE`](/blog/clickhouse-prewhere-vs-where), `argMax`, `uniq`, quantiles, arr…
- After: …happens to execute, you can't express the things you moved to ClickHouse for: [`FINAL`](/blog/clickhouse-final-replacingmergetree-typescript) on a `ReplacingMergeTree`, `LIMIT BY` for top-N-per-group, [`PREWHERE`](/blog/clickhou…

**28.** `content/blog/2026-07-01-does-prisma-support-clickhouse.md`

- Before: …ckHouse for: `FINAL` on a `ReplacingMergeTree`, `LIMIT BY` for top-N-per-group, `PREWHERE`, `argMax`, `uniq`, quantiles, array joins, materialized view targets. Prisma's query API has no vocabulary for any of it, a…
- After: …kHouse for: `FINAL` on a `ReplacingMergeTree`, `LIMIT BY` for top-N-per-group, [`PREWHERE`](/blog/clickhouse-prewhere-vs-where), `argMax`, `uniq`, quantiles, array joins, materialized view targets. Prisma's query A…

**29.** `content/blog/2026-08-11-migrating-moosestack-to-hypequery.md`

- Before: …The builder supports ClickHouse-native `final()`, `limitBy()`, `PREWHERE`, array joins, CTEs, percentiles, `argMax`, and analytical statistics. Window functions use `selectExpr` inside the typed se…
- After: …The builder supports ClickHouse-native `final()`, `limitBy()`, [`PREWHERE`](/blog/clickhouse-prewhere-vs-where), array joins, CTEs, percentiles, `argMax`, and analytical statistics. Window functions…

**30.** `content/blog/2025-07-23-type-safe-schema-management-clickhouse.md`

- Before: …- ReplacingMergeTree, CollapsingMergeTree, AggregatingMergeTree for special use cases…
- After: …- [ReplacingMergeTree](/blog/clickhouse-final-replacingmergetree-typescript), CollapsingMergeTree, AggregatingMergeTree for special use cases…

**31.** `content/blog/2026-07-10-usage-based-billing-clickhouse-typescript.md`

- Before: …me definition. ClickHouse does the aggregation cheaply at any event volume; the semantic layer guarantees the two consumers cannot drift apart, and its tenant rules guarantee one customer never sees another cus…
- After: …e definition. ClickHouse does the aggregation cheaply at any event volume; the [semantic layer](/clickhouse-semantic-layer) guarantees the two consumers cannot drift apart, and its tenant rules guarantee one cu…

**32.** `content/blog/2026-11-15-clickhouse-ai-chat-vercel-ai-sdk.md`

- Before: …Text-to-SQL is the obvious first try, and on ClickHouse it fails in specific ways. A `ReplacingMergeTree` table read without `FINAL` cou…
- After: …[Text-to-SQL](/blog/text-to-sql-vs-semantic-layer) is the obvious first try, and on ClickHouse it fails in specific ways. A `ReplacingMer…

## 2026-11-15 (2): managed ClickHouse services post

Owner-approved follow-up. From 2026-11-11 this post drew most of the site's Generative AI feature impressions in
Search Console (daily impressions 36 → 135 on Nov 11, matching the report's jump). Added a two-sentence "where
hypequery fits" paragraph under the opening answer (the answer itself is unchanged) and extended "A note on
hypequery". New links:

| File | Anchor | Target |
|---|---|---|
| `content/blog/2026-11-08-managed-clickhouse-services-compared.md` | the ClickHouse semantic layer | /clickhouse-semantic-layer |
| same | AI analytics chat for ClickHouse | /clickhouse-ai |
| same | note at the end | #a-note-on-hypequery |
| same | Build an AI analytics chat on ClickHouse | /blog/clickhouse-ai-chat-vercel-ai-sdk |

To revert, delete the second paragraph of the post and the sentence starting "You define metrics, dimensions and
tenant rules once" in "A note on hypequery", and restore the final sentence of that section to: "See the
[quick start](/docs/quick-start), or the [TypeScript client for ClickHouse Cloud](/clickhouse-typescript#clickhouse-cloud)
guide for connecting to ClickHouse Cloud." `updatedAt` moved from 2026-11-08 to 2026-11-15.
