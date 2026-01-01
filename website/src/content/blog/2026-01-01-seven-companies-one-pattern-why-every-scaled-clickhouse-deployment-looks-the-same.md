---
layout: blog
title: "Seven Companies, One Pattern: Why Every Scaled ClickHouse Deployment Looks the Same"
description: "Uber, Cloudflare, Instacart, GitLab, Lyft, Microsoft, and Contentsquare independently built near identical abstraction layers on top of ClickHouse. The shared architecture isn't coincidence, it is forced by the economics of making high performance schemas accessible at organisational scale."
pubDate: 2026-01-01T17:08:36.000Z
heroImage: ""
---

Uber, Cloudflare, Instacart, GitLab, Lyft, Microsoft, and Contentsquare share more than ClickHouse adoption. Each independently built the same abstraction stack—query translation engines, semantic layers, and self service interfaces that let thousands of people query without reading a line of raw ClickHouse SQL. Different industries, different workloads, identical pattern.

This convergence is not stylistic. It is the direct consequence of optimising ClickHouse for speed. Every schema level optimisation that squeezes out milliseconds also adds cognitive overhead that analysts should not carry. Platform teams end up absorbing that complexity into infrastructure because it is the only way to scale.

## The Architecture Everyone Arrives At

Every scaled deployment eventually looks like this:

```
+-------------------------------------------------------------+
|  SELF SERVICE LAYER                                         |
|  Superset, Grafana, Kibana, internal UIs                    |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|  SEMANTIC LAYER                                             |
|  GraphQL schemas, YAML configs, DSLs, metrics catalogs      |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|  QUERY TRANSLATION LAYER                                    |
|  QueryBridge, ABR router, AST optimisers, HogQL compilers   |
+------------------------------+------------------------------+
                               |
+------------------------------v------------------------------+
|  CLICKHOUSE                                                 |
|  Optimised schemas, materialised views, array based storage |
+-------------------------------------------------------------+
```

The tooling changes; Uber leans on Elasticsearch compatible query shapes, Cloudflare wraps everything in GraphQL, Lyft writes TOML while Instacart prefers YAML—but the roles never do.

## The Root Cause: Performance Forces Complexity

The explanation is not that ClickHouse SQL is "hard." The explanation is that **performant ClickHouse schemas are deliberately complex**, so teams build veils between the raw schema and the consumers who only need governed, high level access.

* Uber learned only 5% of indexed fields were queried. Their fix—array based key value storage with runtime type resolution—removed schema conflicts but made direct SQL unusable for most users.
* Contentsquare's AST optimiser propagates partition keys, merges subqueries, and simplifies algebra before emitting SQL. Ten fold speedups materialised, but only after they asked users to describe queries as ASTs rather than SQL strings.
* Instacart orders fraud detection tables by `(shopper_id, created_at_ts)` so partitions prune hundreds of millions of rows. Asking every analyst to reason about sort key permutations does not scale.

Every win on the query planner side adds new rules about materialised columns, adaptive indexing, or array pairs. The abstraction layer hides those rules so performance gains are preserved without retraining an entire company.

## What Each Company Built

| Company      | Translation Layer           | Semantic Layer               | Key Outcome                                           |
|--------------|-----------------------------|------------------------------|-------------------------------------------------------|
| Uber         | QueryBridge (ES → SQL)      | Schema metadata service      | 10,000+ Kibana dashboards migrated unchanged          |
| Cloudflare   | ABR router                  | GraphQL analytics API        | Consistent response times at any data volume          |
| Instacart    | Yoda feature system         | YAML feature definitions     | Engineers shifted from 80% → 20% time on heuristics   |
| Microsoft    | Titan query service         | Visual query builder         | 2,500 non engineers run 100K queries per day          |
| Contentsquare| AST optimiser               | Query representation layer   | 10× speedup on the slowest 5% of queries              |
| GitLab       | ClickHouse::Client          | Arel based QueryBuilder      | Sub second queries across 100M row datasets           |
| Lyft         | Dynamic transpiler          | TOML configurations          | 8× cost reduction versus their previous Druid stack   |

Seven different teams built the identical stack because there is no alternative architecture that survives petabyte scale self service.

## Economics Drive the Convergence

Abstraction layers are an economic decision, not just architectural taste. Without them, each new analyst adds a stream of Jira tickets for query triage and optimisation, so platform headcount grows linearly with the number of people asking questions. With them, platform headcount grows with data volume and infrastructure complexity instead.

Market data echoes this: self service analytics is compounding at ~15% CAGR from $4.8B in 2024 to a projected $17.5B by 2033. Organisations fund these layers because they change cost curves.

Microsoft's Titan team proves the point. A single platform group serves 2,500+ monthly active users executing 100,000 queries daily. Without the abstraction layer, supporting that workload would demand an army of embedded data engineers.

Reported ROI numbers are similarly blunt:

* 40–60% fewer inbound IT data requests
* 30% faster decision making cycles
* 50%+ faster analysis completion
* 30%+ template reuse as platform effects accumulate

These are step changes in organisational throughput, not marginal “quality of life” upgrades.

## Organisational Transformation

Abstractions collapse the feedback loop between “I spotted a pattern” and “I validated it.”

*Before abstraction*: Analyst notices a signal → files a ticket → engineer writes and hardens a query → someone reviews → results show up days later.

*After abstraction*: Analyst encodes logic in a config or UI → platform translates → results land the same day.

Instacart quantified it: before the Yoda platform, engineers spent 80% of their time writing and maintaining fraud heuristics. After YAML based feature definitions on top of ClickHouse, that dropped to 20%. Engineers now work on model quality, not query babysitting.

Uber's QueryBridge migration preserved 10,000+ Kibana dashboards with zero user retraining. Lyft's interfaces let “any person… even an exec that's able to write SQL” touch real time datasets through Trino without ever seeing ClickHouse.

The platform team absorbs complexity once; the organisation scales without proportional engineering headcount.

## Why These Abstractions Become Moats

Once embedded, these layers create natural lock in—not through dark patterns, but through workflow familiarity. Uber's Kibana dashboards represent years of institutional memory. PostHog's HogQL becomes communal language. GitLab's Arel based builders teach analysts GitLab specific conventions. Instacart's YAML definitions capture historical fraud heuristics.

Retraining humans, migrating saved queries, and rebuilding dashboards is far harder than swapping databases. The abstraction layer becomes an asset that justifies further investment.

## AI Is Joining the Stack, Not Sitting on Top

The newest twist is treating AI as native infrastructure inside this stack.

* ClickHouse 25.7 shipped text to SQL generation directly inside the CLI, while ClickHouse Cloud bakes ClickHouse.ai into the workflow with awareness of live schemas and dashboards.
* Shopify wired 30+ MCP (Model Context Protocol) servers into LibreChat so employees issue natural language questions that resolve into governed queries.
* Lightdash combines dbt defined metrics with AI agents that generate chart ready outputs from plain English while respecting semantic layer rules.

The canonical four tier stack now looks like: natural language → semantic layer → query translation → ClickHouse. 2024 was the experiment phase; 2025 onward is standardisation.

## The Insight: Architecture Follows Economics

Seven companies. Billions of events per second. Hundreds of petabytes. Hundreds of thousands of daily queries. Every one of them discovered that ClickHouse performance only democratises insight when the complexity is quarantined behind abstractions.

The pattern holds because:

1. Raw ClickHouse SQL grows unwieldy when schemas are tuned for petabyte performance.
2. Platform teams can internalise that complexity once and unlock sublinear scaling.
3. Business users expect intuitive interfaces, not database literacy.
4. Organisational stickiness forms around tools, saved dashboards, and shared semantics.
5. AI assisted workflows need governed semantic layers as context.

The lesson is not purely technical. It is organisational: **platform teams absorb complexity into infrastructure so analytical capability scales with data volume rather than engineering headcount**. That is why seven companies built the same thing, why the market compounds at 15% annually, and why AI is being wired into the stack itself.

Sources: Engineering blogs from Uber, Cloudflare, Instacart, GitLab, Lyft, Microsoft, Contentsquare, and PostHog; ClickHouse case studies; market data from Mordor Intelligence and Grand View Research.
