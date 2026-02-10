---
title: "The Analytics Language Layer: Why Real-Time Data Needs Typed APIs, Not Just Faster Databases"
description: "We've made our databases real-time. We haven't made our analytics interfaces real-time-safe. The missing abstraction between ClickHouse and your consumers — human or machine — is a typed, programmable analytics language layer."
pubDate: 2026-02-09
heroImage: ""
---

We've made our databases real-time. We haven't made our analytics interfaces real-time-safe.

ClickHouse can ingest a billion rows per second and return aggregations across terabytes in milliseconds. The storage problem is solved. The execution problem is solved. But the interface problem — how consumers actually talk to the engine, remains stuck in the era of hand-crafted SQL strings, copy-pasted metric definitions, and dashboards that nobody trusts.

This gap didn't matter much when the consumer was a human analyst writing a query in a notebook. It matters enormously now that the consumer is increasingly a service, a background job, an embedded dashboard, or an AI agent. The weakest link in the modern analytics stack isn't the database. It's the language we use to talk to it.

## Three Eras of Analytics Interfaces

Analytics tooling has evolved through three distinct phases, each driven by a shift in who or what consumes the data.

**Phase one was dashboards.** BI tools gave business users drag-and-drop access to data warehouses. The industry poured two decades of investment into this model and built a $32B market. The results were underwhelming. Only about 30% of employees across organizations regularly use analytics tools, a figure that has barely moved despite enormous spend. Benn Stancil, co-founder of Mode, captured the problem well: the technology worked, but we didn't get meaningfully better at making decisions.

**Phase two was real-time OLAP.** ClickHouse, Druid, Pinot, and StarRocks proved you could run sub-second analytics on billions of rows without exotic hardware. The real-time analytics software market hit $1.1B in 2025 and is projected to reach $5.26B by 2032. ClickHouse now leads this space with a $15B valuation, 3,000+ customers, and its cloud ARR growing over 250% year-over-year. Phase two solved the speed problem. If your query was correct, the answer came back fast.

**Phase three is happening now.** The primary consumer of analytics is no longer a person staring at a chart. It's a React component fetching data for an embedded dashboard. It's a background job computing features for a fraud model. It's an AI agent translating a natural language question into a database call. Gartner reports that more than 60% of organizations now embed analytics directly into business applications. The embedded analytics market is projected to nearly double from $70B today to $150B+ by 2030.

The shift from phase two to phase three is not incremental. It's a category change in what "consuming analytics" means. When your consumer is code or an LLM, human intuition is no longer a safety net. You need machine-readable contracts, not human-readable dashboards.

## When Your User Is a Model, SQL Becomes a Liability

The push toward AI-driven analytics has exposed a fundamental fragility in text-to-SQL approaches.

Spider 2.0, released in late 2024 with enterprise-level complexity (3,000+ columns, multiple SQL dialects), showed even the best models solving only 17% of queries. The BIRD-Interact benchmark, which simulates real interactive analytics sessions, reports a best-case success rate of 16%. Uber built an internal text-to-SQL system and found only 50% overlap with ground truth on their own evaluation set.

The failure modes are what make this genuinely dangerous. An analysis of 50,000+ production LLM-generated queries found that most broken queries execute successfully and return data, they're semantically wrong but syntactically valid. The model hallucinates columns that don't exist, picks wrong join paths, applies incorrect aggregation logic, or silently drops required filters. You get a clean DataFrame back. The numbers just happen to be wrong.

The evidence for a different approach is already in. Snowflake's internal tests show query accuracy jumping from 40% to 85% when LLMs are routed through a semantic layer instead of raw SQL. DataBrain reports accuracy going from roughly 55% to over 90% with semantic context. dbt Labs reported at Coalesce 2025 that their semantic layer achieved 83% accuracy on natural language analytics questions, with several categories at 100%. The pattern is clear: constrain what the model can express, and accuracy improves dramatically.

## Constraints Beat Cleverness

The lesson generalizes beyond AI. Across every consumer type - human analysts, application code, automated pipelines, AI agents, the same principle holds: systems should make it impossible to express unsafe queries.

The broader data community is converging on this idea. Chad Sanderson's Shift Left Data Manifesto argues that decentralization of engineering cannot come at the cost of quality, data contracts and schema enforcement need to happen at the interface layer, not after the fact. Confluent claims shift-left practices reduce data quality issues by up to 60%. The dbt 2024 State of Analytics Engineering report found 57% of professionals citing poor data quality as a predominant issue, up from 41% two years prior.

The fix isn't better documentation or more careful code review. It's making the interface itself safe by default. Type-safe query builders. Pre-declared metrics and datasets. Schema-aware tooling that catches errors at compile time, not at query time. The system should enforce correctness structurally, not rely on the discipline of the person or model writing the query.

## Defining the Analytics Language Layer

What's needed is an abstraction that doesn't exist cleanly in the current tooling landscape. Call it an analytics language layer: a typed, programmable, stable API for a company's metrics and queries that everything else plugs into.

It's not an ORM — those map objects to rows and optimize for CRUD. It's not a BI tool — those own the visualization and assume human consumers. It's not a raw query builder — those give you flexibility without constraints. The analytics language layer sits between the database and all its consumers, providing a contract that is:

**Type-safe and schema-aware.** Column references, filter expressions, and aggregation logic are validated at compile time. If the schema changes, your build breaks before your dashboards do.

**Versioned and evolvable.** Metrics and query definitions are first-class code constructs with version history, review workflows, and the ability to deprecate gracefully. You can evolve your analytics API the same way you'd evolve a public REST API.

**Multi-protocol.** The same definitions are consumable by backend services, React components, CLI tools, AI agent toolchains, traditional BI. The metric definition is written once; the consumption pattern varies.

**Constrained by design.** The system limits what consumers can express to what's safe and performant against the underlying schema. You can't accidentally query an unpartitioned dimension or join across incompatible grain.

This is the layer that platform teams at scale end up building internally, whether they call it a semantic layer, a metrics catalog, a query translation engine, or something else entirely. The pattern is universal because the problem is universal.

## The Existing Landscape: Close, but Not Quite

Several tools have taken a run at this problem, each with different tradeoffs.

**dbt's Semantic Layer (MetricFlow)** is the most widely discussed approach. After acquiring Transform in 2023, dbt Labs shipped MetricFlow as GA in late 2024 and open-sourced it under Apache 2.0 at Coalesce 2025. It lets you define metrics in YAML and exposes them via a semantic graph that generates SQL. The ecosystem integration is strong — Tableau, Hex, and Mode all connect natively. But dbt was built with batch in mind. The metric definition experience is YAML-heavy; dbt Labs themselves acknowledged that defining metrics was "just plain hard" and simplified the spec in 2025. There's no compile-time type safety — errors are caught at parse time, not by a type system that your IDE understands.

**Cube** is the most API-forward option and was named a Leader in the 2025 GigaOm Radar for semantic layers. It offers REST, GraphQL, SQL, and a dedicated AI API, with a pre-aggregation engine that delivers sub-second response times. Cube requires its own infrastructure (Cube Store), metric definitions live in YAML or JavaScript (not typed TypeScript), and the setup can be heavy for teams that just want a typed layer rather than a full semantic platform.

**Malloy**, created by Lloyd Tabb (co-founder of Looker, inventor of LookML), takes the most principled approach. It's a new programming language with compiler-level aggregate safety, it structurally prevents miscalculating sums, averages, and counts. Tabb's criticism of YAML-based approaches is pointed: YAML configurations that promise "no code required" implicitly signal that data practitioners aren't real developers. The problem is practical: Malloy remains experimental (rewritten three times), has minimal production adoption, no built-in serving layer, and no TypeScript integration.

**LookML** proved the original insight — that centralized, code-based metric definitions can work at scale. Its lesson for the modern era is that the semantic layer needs to be *separate from the BI tool*. LookML's fatal limitation was proprietary lock-in to Google's ecosystem.

Each of these approaches validates a piece of the thesis. dbt proves that metrics-as-code resonates with the community. Cube proves that API-first serving is the right consumption model. Malloy proves that language-level type safety matters. LookML proves that the layer must be independent. But no single tool delivers all of these properties in a package that dominates modern application development.

## Why ClickHouse Is the Right Foundation

ClickHouse's workload profile makes the analytics language layer not just useful but necessary.

The MergeTree engine family is optimized for append-only workloads: parts are immutable, inserts are fully isolated, and one production deployment can sustain over a billion rows per second in ingestion throughput. Incremental materialized views fire on INSERT, enabling a natural architecture: raw events flow in, materialized views pre-aggregate into rollup tables, and fast API reads serve the results. This is inherently an API-shaped workload, not a "human writes exploratory SQL" workload.

ClickHouse itself is explicitly positioning for this future. Their acquisition of Langfuse (open-source LLM observability, 20K+ GitHub stars) signals a bet on AI-native analytics infrastructure. Their MCP server has been downloaded 220K+ times and integrates with Claude Desktop, ChatGPT, Cursor, and custom agents. CEO Aaron Katz has stated directly that the future of analytics is intelligent agents that interpret data, trigger workflows, and power real-time decisions.

But here's the tension: ClickHouse schemas tuned for performance are deliberately complex. Array-based storage, materialized column dependencies, partition key propagation, sort key permutations — every optimization that makes queries fast also makes raw SQL harder to write safely. The database is getting faster; the interface remains fragile. The analytics language layer is what closes that gap.

## What This Looks Like in Practice

This is the reason I built hypequery. I kept seeing teams, scatter raw SQL across services, duplicate metric definitions between dashboards and backend code, and pray that column renames wouldn't silently break something in production. The analytics language layer didn't exist as a library I could npm install, so I started building one.

You define queries in TypeScript, give them names, types, and input schemas (with Zod validation), and execute them anywhere: inside backend services, background jobs, APIs, or AI agent toolchains. The CLI introspects your ClickHouse schema and generates TypeScript types, so column references are checked at compile time. Queries are first-class code constructs, versioned, reviewable, composable — not SQL strings scattered across applications.

```typescript
const { define, queries, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: queries({
    activeUsers: query
      .describe('Most recent active users')
      .input(z.object({
        limit: z.number().min(1).max(500).default(50)
      }))
      .query(({ ctx, input }) =>
        ctx.db
          .table('users')
          .select(['id', 'email', 'created_at'])
          .where('status', 'eq', 'active')
          .orderBy('created_at', 'DESC')
          .limit(input.limit)
          .execute()
      ),
  }),
});
```

hypequery is open source and still early. But the pattern it implements; typed definitions, schema awareness, multi-protocol serving, is what I believe every ClickHouse team will converge on, whether they build it themselves or adopt a tool that does it for them.

## Seven Predictions for the Next Three Years

The analytics language layer isn't a speculative concept. The convergence is already visible. Here's where this heads:

**1. Every serious ClickHouse deployment will have a dedicated analytics language layer** — internal or vendor-provided — sitting between the database and its consumers. The alternative is linear growth in platform engineering headcount as consumer count increases.

**2. AI agents will talk to semantic layers, not databases.** The MCP server approach of exposing raw SQL to agents will mature into structured tool interfaces where agents invoke named, typed queries rather than generating SQL strings. The accuracy data demands it.

**3. BI tools will consume typed endpoints.** Rather than authoring raw SQL or maintaining their own query logic, BI tools will connect to analytics language layers the same way frontend applications consume REST or GraphQL APIs. The Open Semantic Interchange initiative (dbt, Snowflake, Salesforce, ThoughtSpot) is an early signal of this convergence.

**4. Metric definitions will be code, not configuration.** YAML-based metric definitions will give way to programmatic definitions in the same language as the application (TypeScript, Python), enabling IDE support, testing, and the same CI/CD workflows used for application code.

**5. Schema drift will become a build failure, not a production incident.** Type-safe analytics layers will catch breaking schema changes at compile time. The "we renamed a column and three dashboards broke" class of incident will go the way of runtime type errors in typed languages — still possible, but structurally discouraged.

**6. The semantic layer market will consolidate around API-first architectures.** Gartner's concept of "composable analytics" — modular, API-first business components — will define the winning pattern. Tools that can't serve their semantics via APIs will lose ground to those that can.

**7. Real-time and batch semantic layers will merge.** The artificial divide between dbt (batch) and Cube/hypequery (real-time) will collapse as the analytics language layer becomes the single interface regardless of freshness. The layer's job is to provide safe access; the underlying engine handles the latency profile.

## The Challenge

If you're running ClickHouse in production and your consumers are still writing raw SQL strings to query it, you've solved the hard problem (making the database fast) and left the easy problem unsolved (making it safe to talk to).

The analytics language layer is the missing piece. Not because the database needs help, but because every consumer that touches it does. The organizations that adopt this abstraction early will ship fewer data incidents, onboard new teams faster, and safely expose real-time analytics to more products and agents than their competitors.

We've spent a decade making databases real-time. It's time to make the interfaces real-time-safe.
