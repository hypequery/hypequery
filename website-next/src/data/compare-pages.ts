export type ComparePageConfig = {
  slug:
    | 'hypequery-vs-clickhouse-client'
    | 'hypequery-vs-kysely'
    | 'hypequery-vs-drizzle'
    | 'hypequery-vs-prisma'
    | 'hypequery-vs-cube'
    | 'hypequery-vs-tinybird'
    | 'clickhouse-cloud-vs-tinybird'
    | 'cube-vs-tinybird-vs-hypequery'
    | 'hypequery-vs-moose'
    | 'hypequery-vs-dbt'
    | 'hypequery-vs-propel'
    | 'hypequery-vs-typeorm'
    | 'hypequery-vs-metabase'
    | 'hypequery-vs-clickhouse-http'
    | 'hypequery-vs-raw-sql'
    | 'hypequery-vs-clickhouse-connect';
  href: string;
  title: string;
  verdict: string;
  primaryLabel?: string;
  alternativeLabel?: string;
  /** The other tool's name, used in the "When to pick {alternativeName} instead" heading. */
  alternativeName: string;
  /** Overrides the default "When to pick {alternativeName} instead" heading. */
  chooseAlternativeHeading?: string;
  /** Three to five honest situations where the other tool is the better choice. */
  chooseAlternativeWhen: string[];
  rows: Array<{ label: string; hypequery: string; alternative: string }>;
  faq: Array<{ question: string; answer: string }>;
};

export const comparePages: ComparePageConfig[] = [
  {
    slug: 'hypequery-vs-clickhouse-client',
    href: '/compare/hypequery-vs-clickhouse-client',
    title: 'hypequery vs @clickhouse/client',
    verdict:
      '@clickhouse/client is still the right low-level transport layer. hypequery is the better fit when the application also needs generated schema types, reusable query definitions, and a typed API surface on top of ClickHouse.',
    alternativeLabel: '@clickhouse/client',
    alternativeName: '@clickhouse/client',
    chooseAlternativeWhen: [
      'One-off scripts, migrations and admin commands where a connection and a SQL string are all you need.',
      'Bulk loads from Node.js streams, where the client’s streaming insert is the most direct route.',
      'You want the smallest dependency possible: the client has zero external dependencies.',
      'Your team prefers to write and review SQL directly and does not need generated types, endpoints or React hooks.',
    ],
    rows: [
      {
        label: 'Best for',
        hypequery: 'Type-safe analytics layers and app backends',
        alternative: 'Direct ClickHouse access, raw SQL, admin commands and bulk loads',
      },
      {
        label: 'Type safety',
        hypequery: 'Generated from your ClickHouse schema',
        alternative: 'Manual response annotations',
      },
      {
        label: 'Query parameters',
        hypequery: 'Builder values are sent as bound parameters, never interpolated',
        alternative: 'query_params with {name:Type} placeholders in SQL you write',
      },
      {
        label: 'Inserts and streaming',
        hypequery: 'Typed insert builder; stream() and Arrow streaming for reads',
        alternative: 'Streaming for both selects and inserts',
      },
      {
        label: 'Reuse',
        hypequery: 'One query definition across local execution, HTTP, and React',
        alternative: 'You build the abstraction yourself',
      },
      {
        label: 'HTTP API',
        hypequery: '@hypequery/serve adds validation, auth, rate limiting and OpenAPI',
        alternative: 'None: it connects your server to ClickHouse',
      },
      {
        label: 'Caching',
        hypequery: 'Optional query result cache with a pluggable provider',
        alternative: 'None in the client; the ClickHouse query cache works from any client',
      },
    ],
    faq: [
      {
        question: 'Does hypequery replace @clickhouse/client?',
        answer:
          'No. hypequery builds on the same ClickHouse access model and adds typed query and serving layers for application teams.',
      },
      {
        question: 'When should I stay with the official client?',
        answer:
          'Stay with the official client for one-off scripts, bulk loads from Node.js streams, admin commands, or cases where raw SQL control is the main requirement. hypequery has a typed insert builder for rows written from application code, but it is built mainly for reads.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-kysely',
    href: '/compare/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    verdict:
      'Kysely is an excellent general TypeScript query builder. hypequery is narrower and more opinionated around ClickHouse runtime type mapping, schema generation, and reusable analytics APIs.',
    alternativeLabel: 'Kysely',
    alternativeName: 'Kysely',
    chooseAlternativeWhen: [
      'Your main database is Postgres, MySQL, SQLite or SQL Server, and ClickHouse is a small side workload.',
      'You want one query builder across several databases in the same codebase.',
      'You only need a query builder, not HTTP endpoints, React hooks or MCP tools on top of it.',
      'Your team already knows Kysely and is happy to maintain ClickHouse interfaces and a community dialect itself.',
    ],
    rows: [
      {
        label: 'Best for',
        hypequery: 'ClickHouse-first TypeScript analytics',
        alternative: 'General SQL query building, especially Postgres',
      },
      {
        label: 'ClickHouse support',
        hypequery: 'Built for ClickHouse',
        alternative: 'Through a community dialect (@founderpath/kysely-clickhouse), not a core dialect',
      },
      {
        label: 'Schema source',
        hypequery: 'Generated from live ClickHouse schema',
        alternative: 'Usually hand-maintained TypeScript interfaces',
      },
      {
        label: 'Runtime type mapping',
        hypequery: 'Generated types match what the adapter returns: UInt64 and DateTime as strings',
        alternative: 'You encode the mapping in the interfaces you write',
      },
      {
        label: 'ClickHouse clauses',
        hypequery: 'FINAL, LIMIT BY, ARRAY JOIN and CTEs are builder methods',
        alternative: 'Generic SQL builder; ClickHouse-only clauses go through the sql template tag',
      },
      {
        label: 'Application layer',
        hypequery: 'Query builder, HTTP serving, OpenAPI, React hooks, MCP',
        alternative: 'Query builder only',
      },
      {
        label: 'Multi-tenancy',
        hypequery: 'Tenant scope injected from the auth context by @hypequery/serve',
        alternative: 'Your own where clauses in each query',
      },
    ],
    faq: [
      {
        question: 'Can Kysely work with ClickHouse?',
        answer:
          'Yes, through a community dialect listed in the Kysely docs (@founderpath/kysely-clickhouse). You still need to handle ClickHouse-specific runtime type mappings and application-level reuse yourself.',
      },
      {
        question: 'When is hypequery a better fit?',
        answer:
          'Use hypequery when ClickHouse is powering dashboards, APIs, jobs, or SaaS analytics where the same typed query contract needs to be reused.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-drizzle',
    href: '/compare/hypequery-vs-drizzle',
    title: 'hypequery vs Drizzle',
    verdict:
      'Drizzle ORM does not support ClickHouse. hypequery is the TypeScript-first alternative for teams who want schema generation from a live ClickHouse database, a composable query builder, and a typed API layer.',
    alternativeLabel: 'Drizzle',
    alternativeName: 'Drizzle',
    chooseAlternativeWhen: [
      'The data is transactional and lives in PostgreSQL, MySQL, SQLite, SingleStore, MSSQL or CockroachDB.',
      'You want the schema defined in TypeScript, with migrations generated and run by drizzle-kit.',
      'You need relations, foreign keys and transactions for application writes, which ClickHouse is not built for.',
      'You run Postgres next to ClickHouse: use Drizzle for the Postgres side and hypequery only for ClickHouse.',
    ],
    rows: [
      {
        label: 'ClickHouse support',
        hypequery: 'Built specifically for ClickHouse',
        alternative: 'Not supported. Drizzle lists PostgreSQL, MySQL, SQLite, SingleStore, MSSQL and CockroachDB',
      },
      {
        label: 'Best for',
        hypequery: 'Analytics queries and APIs on ClickHouse',
        alternative: 'Transactional application data on the databases it supports',
      },
      {
        label: 'Schema source',
        hypequery: 'Generated from live ClickHouse schema',
        alternative: 'Defined in TypeScript, pushed to database',
      },
      {
        label: 'Migrations',
        hypequery: 'Leaves ClickHouse DDL to your migration tool',
        alternative: 'drizzle-kit generate, migrate and push',
      },
      {
        label: 'Runtime type mapping',
        hypequery: 'ClickHouse-specific: UInt64 and DateTime as strings, Nullable as T | null',
        alternative: 'Mappings for its supported databases only',
      },
      {
        label: 'Analytics layer',
        hypequery: 'Query builder, HTTP serving, OpenAPI, React hooks, MCP',
        alternative: 'ORM and query builder; no analytics serving layer',
      },
    ],
    faq: [
      {
        question: 'Does Drizzle support ClickHouse?',
        answer:
          'No. The Drizzle docs list PostgreSQL, MySQL, SQLite, SingleStore, MSSQL and CockroachDB, and ClickHouse is not among them. hypequery is the dedicated TypeScript-first alternative for ClickHouse workloads.',
      },
      {
        question: 'Can I use Drizzle for Postgres and hypequery for ClickHouse?',
        answer:
          'Yes — this is a common setup. Use Drizzle for your transactional Postgres data and hypequery for your ClickHouse analytics workload.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-prisma',
    href: '/compare/hypequery-vs-prisma',
    title: 'hypequery vs Prisma',
    verdict:
      'Prisma does not support ClickHouse. hypequery gives TypeScript teams the closest equivalent for ClickHouse analytics: schema generation, typed queries, and an API layer built around the ClickHouse data model.',
    alternativeLabel: 'Prisma',
    alternativeName: 'Prisma',
    chooseAlternativeWhen: [
      'Your application data lives in PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB or MongoDB.',
      'You want a schema file, a generated client and migrations in one tool.',
      'You need relations and transactions for application writes, which ClickHouse is not designed around.',
      'Run both: Prisma for the transactional database and hypequery for ClickHouse analytics.',
    ],
    rows: [
      {
        label: 'ClickHouse support',
        hypequery: 'Built specifically for ClickHouse',
        alternative: 'Not supported. Prisma ORM 7 covers PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB and MongoDB',
      },
      {
        label: 'Best for',
        hypequery: 'Analytics queries and APIs on ClickHouse',
        alternative: 'Transactional application data',
      },
      {
        label: 'Schema approach',
        hypequery: 'Introspect live ClickHouse database → generate types',
        alternative: 'Define schema in Prisma schema file → generate client',
      },
      {
        label: 'Query layer',
        hypequery: 'Analytics-optimised query builder with ClickHouse-native syntax',
        alternative: 'Relational ORM: tables, relations, transactions',
      },
      {
        label: 'Migrations',
        hypequery: 'ClickHouse DDL stays with your own migration tool',
        alternative: 'Prisma Migrate for its supported databases',
      },
      {
        label: 'Analytics serving',
        hypequery: 'HTTP endpoints, OpenAPI, React hooks and MCP tools',
        alternative: 'Not in scope',
      },
    ],
    faq: [
      {
        question: 'Does Prisma support ClickHouse?',
        answer:
          'No. Prisma is designed for transactional databases: Prisma ORM 7 supports PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB and MongoDB. ClickHouse has a different data model and is not on that list.',
      },
      {
        question: 'Can I use Prisma alongside hypequery?',
        answer:
          'Yes — many teams use Prisma for Postgres application data and hypequery for ClickHouse analytics. They handle different parts of the stack.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-cube',
    href: '/compare/hypequery-vs-cube',
    title: 'hypequery vs Cube',
    verdict:
      'Cube is a semantic layer platform for centralized metrics. hypequery is a lighter, code-first analytics layer that lives in your codebase, in TypeScript or Python, for product engineers building ClickHouse-backed features. They solve different problems.',
    alternativeLabel: 'Cube',
    alternativeName: 'Cube',
    chooseAlternativeWhen: [
      'BI tools such as Tableau, Power BI or Metabase need the same metric definitions as your app, through Cube’s Postgres-compatible SQL API.',
      'Your metrics span several databases, not only ClickHouse.',
      'Expensive queries hit by many users need managed pre-aggregations in Cube Store.',
      'A data team owns metric definitions separately from the product engineers who consume them.',
      'You want the vendor to host analytics agents and chat on top of the semantic layer, as Cube Cloud does.',
    ],
    rows: [
      {
        label: 'Best for',
        hypequery: 'Product engineers building ClickHouse features in TypeScript or Python',
        alternative: 'Centralised metrics for BI tools and multiple consumers',
      },
      {
        label: 'Setup',
        hypequery: 'A package install, no separate infrastructure. Optional hosting on hypequery cloud',
        alternative: 'Cube API instances, a refresh worker, and Cube Store router and worker nodes, or Cube Cloud',
      },
      {
        label: 'Workflow',
        hypequery: 'Fully code-first — lives in your codebase, in TypeScript or Python',
        alternative: 'Data model in YAML or JavaScript files, served by the Cube deployment',
      },
      {
        label: 'Databases',
        hypequery: 'ClickHouse only, by design',
        alternative: 'Many SQL sources, including ClickHouse, Snowflake, BigQuery and Postgres',
      },
      {
        label: 'BI tools',
        hypequery: 'Not a goal; typed application APIs instead',
        alternative: 'Postgres-compatible SQL API for Tableau, Power BI, Metabase and Superset',
      },
      {
        label: 'Caching',
        hypequery: 'Optional query result cache; ClickHouse materialized views for rollups',
        alternative: 'Pre-aggregations and caching in Cube Store',
      },
      {
        label: 'Agents and MCP',
        hypequery: '@hypequery/mcp exposes datasets and metrics as MCP tools',
        alternative: 'Cube Cloud includes an MCP server and analytics agents, from the Free plan',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source (Apache 2.0)',
        alternative: 'Cube Core is Apache 2.0; Cube Cloud has a Free plan, then $40 or $80 per developer per month',
      },
    ],
    faq: [
      {
        question: 'When should I use Cube instead of hypequery?',
        answer:
          'Choose Cube when you need BI tool integration (Tableau, Metabase), pre-aggregations at scale, or a centralised metric definition layer served to multiple non-engineering consumers.',
      },
      {
        question: 'Can hypequery and Cube be used together?',
        answer:
          'Yes — some teams use Cube for the data team and BI layer, and hypequery for product-facing analytics features where application integration and engineering velocity matter more.',
      },
      {
        question: 'Does Cube still need Redis?',
        answer:
          'No. Cube deprecated Redis in v0.32 and removed support in v0.36. Cube Store now handles the cache, the query queue and pre-aggregations, so a production Cube Core deployment runs API instances, a refresh worker, and Cube Store router and worker nodes.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-tinybird',
    href: '/compare/hypequery-vs-tinybird',
    title: 'hypequery vs Tinybird',
    verdict:
      'Tinybird is a managed ClickHouse platform with a built-in API layer. hypequery is the better fit when your data needs to stay in your own ClickHouse and your team wants the analytics layer as code it owns, in TypeScript or Python.',
    alternativeLabel: 'Tinybird',
    alternativeName: 'Tinybird',
    chooseAlternativeWhen: [
      'You do not run ClickHouse yet and nobody on the team wants to operate it.',
      'The deliverable is hosted analytics APIs, and you want ingestion, endpoint hosting and token auth handled by one platform.',
      'Your team is more SQL-fluent than TypeScript-fluent and would rather publish SQL pipes than write application code.',
      'A vendor-run region meets your data residency and compliance needs.',
    ],
    rows: [
      {
        label: 'Infrastructure',
        hypequery: 'Bring your own ClickHouse: self-hosted, ClickHouse Cloud or another provider',
        alternative: 'Managed ClickHouse platform',
      },
      {
        label: 'Data location',
        hypequery: 'Stays in your own infrastructure',
        alternative: 'Ingested into Tinybird. Self-managed regions in your own AWS account are in beta, for development only',
      },
      {
        label: 'Code ownership',
        hypequery: 'Definitions live in your codebase, in TypeScript or Python',
        alternative: 'Datafiles or TypeScript definitions in your repo, deployed to Tinybird with the CLI',
      },
      {
        label: 'TypeScript types',
        hypequery: 'Generated from your live schema',
        alternative: 'Inferred from resources you define with @tinybirdco/sdk, which Tinybird marks experimental',
      },
      {
        label: 'Auth and rate limits',
        hypequery: '@hypequery/serve: JWT auth, tenant scoping and rateLimit middleware',
        alternative: 'Tokens, plus JWTs with per-token rate limits and fixed tenant parameters',
      },
      {
        label: 'Agents and MCP',
        hypequery: '@hypequery/mcp exposes datasets and metrics as MCP tools',
        alternative: 'Tinybird MCP server with token-scoped access to a workspace',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source; you pay for your own ClickHouse',
        alternative: 'Free plan, then plans sized in vCPUs plus storage, egress and vCPU overages',
      },
    ],
    faq: [
      {
        question: 'Does hypequery replace Tinybird?',
        answer:
          'Not directly — they solve the same problem differently. Tinybird is a managed platform that handles ClickHouse infrastructure, ingestion, endpoint hosting, and auth for you. hypequery is an open-source library you add to your own project, assuming you already run ClickHouse. If you want zero ops and are comfortable with your data living in a third-party platform, Tinybird is compelling. If you want someone else to run the layer but keep the data in your own ClickHouse, hypequery cloud (in early access) hosts the same definitions. If you want data sovereignty, schema-generated TypeScript types, and code-first control, hypequery is the better fit.',
      },
      {
        question: 'When should I choose Tinybird over hypequery?',
        answer:
          'Choose Tinybird when you have no ops team to manage ClickHouse, need a fast path from raw data to a public API, and data residency or vendor lock-in are not concerns. It is also a good fit when your team is more SQL-fluent than TypeScript-fluent and you want token-based auth and per-token rate limits built into the platform.',
      },
      {
        question: 'Does Tinybird have a TypeScript SDK?',
        answer:
          'Yes. @tinybirdco/sdk defines data sources and endpoints in TypeScript and infers row, parameter and output types from those definitions. Tinybird marks it experimental. The types come from the definitions you write, while hypequery generates them by introspecting the ClickHouse you already run.',
      },
    ],
  },
  {
    slug: 'clickhouse-cloud-vs-tinybird',
    href: '/compare/clickhouse-cloud-vs-tinybird',
    title: 'ClickHouse Cloud vs Tinybird',
    verdict:
      'ClickHouse Cloud is a managed ClickHouse database billed by compute time and compressed storage. Tinybird is a platform on ClickHouse that adds ingestion, hosted SQL API endpoints and tokens, billed by plan size in vCPUs. Pick Tinybird for hosted analytics APIs with little backend work; pick ClickHouse Cloud when your own services and tools need direct read and write access to ClickHouse.',
    primaryLabel: 'ClickHouse Cloud',
    alternativeLabel: 'Tinybird',
    alternativeName: 'Tinybird',
    chooseAlternativeHeading: 'When Tinybird is the better pick',
    chooseAlternativeWhen: [
      'The deliverable is hosted analytics APIs, and you want ingestion and endpoint hosting handled for you.',
      'You want to start on a free plan with no time limit: 0.25 vCPU, 1,000 requests per day and 10 GB.',
      'You prefer a monthly plan sized in vCPUs to compute metered per compute-unit-hour.',
      'Your frontend or partners call endpoints with scoped tokens, and no service needs direct write access to the database.',
    ],
    rows: [
      {
        label: 'Product shape',
        hypequery: 'Managed ClickHouse database run by ClickHouse, Inc.',
        alternative: 'Platform on ClickHouse with data sources, pipes, API endpoints, tokens and branches',
      },
      {
        label: 'Billing',
        hypequery: 'Compute per compute-unit-hour (8 GiB RAM, 2 vCPUs), metered per minute, plus storage per TB-month',
        alternative: 'Plan sized in vCPUs: fixed monthly fee on Developer, credits with a 12-month commitment on SaaS and Enterprise',
      },
      {
        label: 'Entry price',
        hypequery: 'About $160/month of compute for the smallest Basic service running 24/7, plus storage',
        alternative: 'Developer from $25/month; the 0.5 vCPU size is $49/month with 25 GB included',
      },
      {
        label: 'Free option',
        hypequery: '$300 in credits for 30 days, then pay-as-you-go',
        alternative: 'Free plan with no time limit: 0.25 vCPU, 1,000 requests per day, 10 GB',
      },
      {
        label: 'SQL access',
        hypequery: 'Read and write over HTTPS, the native protocol and the MySQL wire protocol',
        alternative: 'Hosted endpoints and Query API; the ClickHouse HTTP interface is read-only',
      },
      {
        label: 'Your own cloud',
        hypequery: 'BYOC generally available on AWS, GCP and Azure, with a committed contract',
        alternative: 'Self-managed regions in beta, for development environments only',
      },
      {
        label: 'TypeScript',
        hypequery: '@clickhouse/client over HTTPS; hypequery adds schema-generated types and a query builder',
        alternative: '@tinybirdco/sdk defines data sources and endpoints; @clickhouse/client works for reads',
      },
    ],
    faq: [
      {
        question: 'Is Tinybird more expensive than ClickHouse Cloud?',
        answer:
          'Not at the entry level. Tinybird Developer starts at $25/month, and its 0.5 vCPU size is $49/month with 25 GB of storage and endpoint hosting included. The smallest ClickHouse Cloud service (Basic, 8 GiB and 2 vCPUs on AWS us-east-1) costs $159.66/month in compute running 24/7, plus $25.30 per TB-month of storage, and less if it idles. ClickHouse Cloud gives more compute for the money, and Tinybird SaaS and Enterprise plans are custom-priced, so for larger workloads compare both calculators. Prices checked on 9 November 2026.',
      },
      {
        question: 'Is Tinybird built on ClickHouse?',
        answer:
          'Yes. Tinybird says it runs native ClickHouse under the hood, but you work through Tinybird resources such as data sources, pipes and endpoints. Tinybird is a separate company and states it is not affiliated with ClickHouse, Inc.',
      },
      {
        question: 'Can I connect to Tinybird with a ClickHouse client?',
        answer:
          'Yes, for reads. Tinybird exposes a ClickHouse-compatible HTTP interface that works with @clickhouse/client and BI tools, authenticated with a Tinybird token. The connection is read-only, so writes go through Tinybird ingestion.',
      },
      {
        question: 'What is the TypeScript client for ClickHouse Cloud?',
        answer:
          'The official client is @clickhouse/client for Node.js, or @clickhouse/client-web for browsers and Cloudflare Workers, connecting over HTTPS on port 8443. hypequery builds on it with types generated from your live ClickHouse Cloud schema and a typed query builder.',
      },
      {
        question: 'Which should I pick, Tinybird or ClickHouse Cloud?',
        answer:
          'Pick Tinybird when the deliverable is hosted analytics APIs and you want ingestion and endpoint hosting handled for you. Pick ClickHouse Cloud when services, jobs and BI tools need full SQL access to the database, when you need Azure or BYOC, or when analytics logic should live in your own application code.',
      },
    ],
  },
  {
    slug: 'cube-vs-tinybird-vs-hypequery',
    href: '/compare/cube-vs-tinybird-vs-hypequery',
    title: 'Cube vs Tinybird vs hypequery',
    verdict:
      'Cube, Tinybird, and hypequery all put an API layer between ClickHouse and applications, but they have different shapes: semantic layer platform, managed analytics service, and an open-source analytics layer in your codebase.',
    alternativeLabel: 'Cube and Tinybird',
    alternativeName: 'Cube or Tinybird',
    chooseAlternativeWhen: [
      'Pick Cube when BI tools and your app must share one set of metric definitions, across more than one database.',
      'Pick Cube when expensive queries hit by many users need managed pre-aggregations.',
      'Pick Tinybird when you do not run ClickHouse yet and want ingestion plus hosted API endpoints with no ops.',
      'Pick Tinybird when the team is SQL-first and wants endpoints with token auth and rate limits from the platform.',
    ],
    rows: [
      {
        label: 'Shape',
        hypequery: 'Open-source library inside your app, in TypeScript or Python',
        alternative: 'Cube is a semantic layer platform; Tinybird is a managed analytics backend',
      },
      {
        label: 'Data ownership',
        hypequery: 'Uses the ClickHouse you already run',
        alternative: 'Cube queries your databases; Tinybird typically runs the ClickHouse platform for you',
      },
      {
        label: 'TypeScript workflow',
        hypequery: 'Queries and response types live in your repo, generated from your schema',
        alternative: 'Cube and Tinybird expose platform APIs that your app consumes',
      },
      {
        label: 'Best fit',
        hypequery: 'Product teams with an existing ClickHouse, in TypeScript or Python',
        alternative: 'Cube for shared BI semantics; Tinybird for zero-ops hosted analytics APIs',
      },
      {
        label: 'BI tools',
        hypequery: 'Not a goal; typed application APIs instead',
        alternative: 'Cube: Postgres-compatible SQL API. Tinybird: read-only ClickHouse-compatible HTTP interface',
      },
      {
        label: 'Caching and rollups',
        hypequery: 'Optional query result cache; ClickHouse materialized views',
        alternative: 'Cube: pre-aggregations in Cube Store. Tinybird: materialized views and copy pipes',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source',
        alternative: 'Cube Cloud: per developer seat, with a Free plan. Tinybird: plans sized in vCPUs, with a free plan',
      },
      {
        label: 'Agents and MCP',
        hypequery: '@hypequery/mcp over your datasets and metrics',
        alternative: 'Both ship MCP servers for their platforms',
      },
    ],
    faq: [
      {
        question: 'When should I choose Cube?',
        answer:
          'Choose Cube when multiple consumers, especially BI tools, need the same metric definitions and pre-aggregations from a central semantic layer.',
      },
      {
        question: 'When should I choose Tinybird?',
        answer:
          'Choose Tinybird when you want the fastest managed path from data ingestion to hosted analytics APIs and are comfortable with the platform owning that serving layer.',
      },
      {
        question: 'When should I choose hypequery?',
        answer:
          'Choose hypequery when you already run ClickHouse and want schema-generated datasets and served endpoints inside your own application codebase, in TypeScript or Python.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-moose',
    href: '/compare/hypequery-vs-moose',
    title: 'hypequery vs Moose (MooseStack)',
    verdict:
      'MooseStack has reached end of life and is no longer actively maintained. Do not start a new production system on it. hypequery is the active, narrower replacement for its query models, APIs, React hooks, and MCP tools, in TypeScript or Python.',
    alternativeLabel: 'MooseStack',
    alternativeName: 'MooseStack',
    chooseAlternativeHeading: 'When to keep MooseStack for now',
    chooseAlternativeWhen: [
      'Your Moose app runs in production and works today: migrate one query model at a time rather than in one cutover.',
      'You depend on Moose’s streaming and workflow modules and have not chosen replacements yet. hypequery does not cover streaming, workflows or DDL migrations.',
      'Your ClickHouse schema is declared in Moose code and no migration tool owns the DDL yet.',
    ],
    rows: [
      {
        label: 'Project status',
        hypequery: 'Adding typed queries and APIs to a ClickHouse you already run',
        alternative: 'End of life and no longer actively maintained',
      },
      {
        label: 'Schema source',
        hypequery: 'Introspected from your live ClickHouse schema',
        alternative: 'Defined in code and migrated into ClickHouse',
      },
      {
        label: 'Migration boundary',
        hypequery: 'Typed queries, semantic datasets, APIs, React hooks, and MCP',
        alternative: 'Move DDL, Redpanda, and Temporal responsibilities separately',
      },
      {
        label: 'Scope',
        hypequery: 'Actively maintained TypeScript and Python packages inside your application',
        alternative: 'Unmaintained framework code can inform migration but should not be a new dependency',
      },
      {
        label: 'Languages',
        hypequery: 'TypeScript; Python SDK in beta',
        alternative: 'TypeScript and Python',
      },
      {
        label: 'Streaming and workflows',
        hypequery: 'Not covered: keep dedicated ingestion and workflow tools',
        alternative: 'Redpanda and Temporal modules, now unmaintained',
      },
      {
        label: 'Agents and MCP',
        hypequery: 'Governed dataset and metric MCP server, from either SDK',
        alternative: 'Development harness MCP and query-model tools',
      },
    ],
    faq: [
      {
        question: 'Are hypequery and Moose solving the same problem?',
        answer:
          'They overlap on typed ClickHouse queries and APIs, but Moose also owned schema, streaming, workflows, and a development runtime. hypequery replaces the application-facing analytics layer; dedicated tools should own the other responsibilities.',
      },
      {
        question: 'Should I choose MooseStack for a new project?',
        answer:
          'No. MooseStack’s maintainers announced end of life and the project is no longer actively maintained. Use the historical architecture as migration context, not as a new production dependency.',
      },
      {
        question: 'I used MooseStack from Python. Is there a Python path?',
        answer:
          'Yes. The hypequery Python SDK (beta) defines the same datasets in Python, serves them from FastAPI, Django, or Flask, exposes them to agents with hypequery mcp, and feeds the same React hooks through an exported client contract. Python has no query builder; queries go through datasets.',
      },
      {
        question: 'Can hypequery replace every MooseStack module?',
        answer:
          'No. hypequery covers typed ClickHouse queries, semantic datasets, APIs, React hooks, multi-tenancy, and MCP. Keep or choose separate tools for DDL migrations, streaming ingestion, and workflow orchestration.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-dbt',
    href: '/compare/hypequery-vs-dbt',
    title: 'hypequery vs dbt',
    verdict:
      'dbt transforms data inside ClickHouse on a schedule. hypequery serves ClickHouse data to applications at request time, from TypeScript or Python. Most teams comparing them are really deciding where the transformation boundary sits — and many end up using both.',
    alternativeLabel: 'dbt',
    alternativeName: 'dbt',
    chooseAlternativeWhen: [
      'You need scheduled transformations: raw events cleaned, joined and deduplicated into tables before anyone queries them.',
      'A data team owns the models and works in SQL with Jinja.',
      'Several consumers, including BI tools, read the same materialised tables.',
      'You want incremental models rebuilt on a schedule instead of computed on each request.',
    ],
    rows: [
      {
        label: 'Job',
        hypequery: 'Runtime queries and typed APIs for application code',
        alternative: 'Scheduled SQL transformations inside the warehouse',
      },
      {
        label: 'Language',
        hypequery: 'TypeScript or Python, generated from the live schema',
        alternative: 'SQL with Jinja templating',
      },
      {
        label: 'Runs',
        hypequery: 'In your app, in response to user requests',
        alternative: 'On a schedule or trigger via dbt run',
      },
      {
        label: 'Output',
        hypequery: 'Typed query results, REST endpoints, React hooks',
        alternative: 'Materialised tables and views in ClickHouse',
      },
      {
        label: 'ClickHouse support',
        hypequery: 'Built for ClickHouse',
        alternative: 'dbt-clickhouse adapter: table, view, incremental and ephemeral, with materialized views marked experimental',
      },
      {
        label: 'Multi-tenancy',
        hypequery: 'Tenant scope injected per request from your auth context',
        alternative: 'Not in scope; dbt builds shared tables',
      },
    ],
    faq: [
      {
        question: 'Does dbt support ClickHouse?',
        answer:
          'Yes — the dbt-clickhouse adapter covers the common materialisation patterns, though ClickHouse semantics (no transactions, MergeTree engines) mean some dbt patterns from Postgres do not translate directly.',
      },
      {
        question: 'Do hypequery and dbt compete?',
        answer:
          'Mostly no. dbt prepares data inside ClickHouse; hypequery serves it to applications with type safety. A common stack is dbt for modelling raw events into analytics tables and hypequery for querying those tables from product code.',
      },
      {
        question: 'When would hypequery replace dbt?',
        answer:
          'If your only use of dbt is preparing a handful of tables that feed application APIs, a typed TypeScript layer querying the source tables directly — or ClickHouse materialized views — can be simpler than maintaining a separate transformation project.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-propel',
    href: '/compare/hypequery-vs-propel',
    title: 'hypequery vs Propel',
    verdict:
      'Propel was a serverless analytics platform on ClickHouse with GraphQL and SQL APIs, a semantic layer and embeddable React components. As of 8 November 2026 its website, docs and console addresses all point to a domain-parking page, so do not plan new work on it. hypequery covers the typed API layer on a ClickHouse you run; Tinybird is the closest active managed platform.',
    alternativeLabel: 'Propel',
    alternativeName: 'a managed platform',
    chooseAlternativeHeading: 'When a managed platform fits better than hypequery',
    chooseAlternativeWhen: [
      'You picked Propel to avoid building any API layer: Tinybird is the closest active option, with hosted endpoints, tokens and JWT rate limits.',
      'You mainly used Propel’s prebuilt dashboard components: an embeddable BI tool such as Metabase gets charts in front of customers with less code.',
      'You never ran ClickHouse yourself and do not want to start: a managed ClickHouse service or platform has to come first.',
      'Non-engineers need to build the dashboards themselves.',
    ],
    rows: [
      {
        label: 'Status',
        hypequery: 'Actively maintained, open source',
        alternative: 'propeldata.com, its docs and its console point to a domain-parking page (checked 8 November 2026)',
      },
      {
        label: 'Model',
        hypequery: 'Open-source library inside your app',
        alternative: 'Was a serverless platform with GraphQL and SQL APIs',
      },
      {
        label: 'TypeScript types',
        hypequery: 'Generated from your live ClickHouse schema',
        alternative: 'Was GraphQL codegen against Propel’s API schema',
      },
      {
        label: 'UI',
        hypequery: 'Your own components on typed React hooks',
        alternative: 'Was a React UI kit; @propeldata/ui-kit was last published to npm in January 2025',
      },
      {
        label: 'Multi-tenancy',
        hypequery: 'Tenant scope from your auth context, per request',
        alternative: 'Was platform-level access policies',
      },
      {
        label: 'Data location',
        hypequery: 'Always your own ClickHouse',
        alternative: 'Was managed storage, or a connection to your existing ClickHouse',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source; you pay for your own infrastructure',
        alternative: 'Was usage-based',
      },
    ],
    faq: [
      {
        question: 'Is Propel still available?',
        answer:
          'We could not find it running. On 8 November 2026, propeldata.com redirected to a domain-parking page that lists the domain for sale, and the docs, console and API hostnames resolved to the same parking service. We found no official shutdown announcement, so existing customers should confirm with their Propel contact, but new projects should not depend on it.',
      },
      {
        question: 'What replaces Propel’s GraphQL APIs?',
        answer:
          'If Propel was connected to your own ClickHouse, point hypequery at the same database and serve typed REST endpoints with OpenAPI from @hypequery/serve, in TypeScript, or from FastAPI, Django or Flask in Python. If Propel stored the data for you, you need a ClickHouse first: self-hosted, ClickHouse Cloud, or a platform such as Tinybird.',
      },
      {
        question: 'What about Propel’s UI components?',
        answer:
          '@propeldata/ui-kit is still on npm, last published in January 2025, but the components were built to query Propel’s APIs. Rebuild the charts with your own components on @hypequery/react hooks, or embed a BI tool if you would rather not build charts.',
      },
    ],
  },

  {
    "slug": "hypequery-vs-typeorm",
    "href": "/compare/hypequery-vs-typeorm",
    "title": "hypequery vs TypeORM",
    "verdict": "TypeORM does not support ClickHouse and has no credible workaround — its entity/decorator model is built for transactional row stores, not columnar append-only analytics. hypequery is the ClickHouse-native TypeScript layer; the realistic setup is coexistence, with TypeORM on Postgres/MySQL and hypequery on the ClickHouse side.",
    "alternativeLabel": "TypeORM",
    "alternativeName": "TypeORM",
    "chooseAlternativeWhen": [
      "Your data is transactional: entities with relations, foreign keys and transactions on Postgres, MySQL or another database TypeORM supports.",
      "You want decorated entity classes, migrations, and the Active Record or Data Mapper pattern.",
      "The workload is row-level reads and writes with lifecycle hooks, not aggregations over millions of rows.",
      "You already run TypeORM in a Nest or Express service: keep it for the OLTP side and add hypequery only for ClickHouse."
    ],
    "rows": [
      {
        "label": "ClickHouse support",
        "hypequery": "Native — built specifically for ClickHouse",
        "alternative": "None. Drivers cover MySQL/MariaDB, Postgres, CockroachDB, SQLite, SQL Server, Oracle, SAP HANA, Spanner and MongoDB"
      },
      {
        "label": "Data model",
        "hypequery": "Columnar analytics: aggregations, time grains, tenant scoping",
        "alternative": "Relational entities: FKs, transactions, migrations, identity map"
      },
      {
        "label": "Schema source",
        "hypequery": "Generated from your live ClickHouse schema",
        "alternative": "Decorated entity classes, migrated to the database"
      },
      {
        "label": "Type mapping",
        "hypequery": "ClickHouse-correct (UInt64 → string, DateTime → string, Nullable → T | null)",
        "alternative": "Column types for OLTP engines; no ClickHouse column set"
      },
      {
        "label": "Analytics layer",
        "hypequery": "Query builder, HTTP serving, OpenAPI, React hooks",
        "alternative": "Repository/entity CRUD — no analytics serving layer"
      },
      {
        "label": "Multi-tenancy",
        "hypequery": "Tenant scope injected per request from your auth context",
        "alternative": "Not built in; you add tenant conditions to each query"
      }
    ],
    "faq": [
      {
        "question": "Does TypeORM support ClickHouse?",
        "answer": "No. TypeORM has no ClickHouse driver, and there is no MySQL-port style workaround that holds up, because its entity model (foreign keys, transactions, migrations, the identity map) assumes a row-oriented transactional database. hypequery is built natively for ClickHouse instead."
      },
      {
        "question": "Can I use TypeORM for Postgres and hypequery for ClickHouse in the same app?",
        "answer": "Yes — this is the recommended setup. Keep TypeORM on your Postgres or MySQL entities and add hypequery for the ClickHouse analytics side. They run side by side in one Nest or Express service without competing for the same tables."
      },
      {
        "question": "Is hypequery an ORM?",
        "answer": "No. hypequery is a typed query builder and serving layer for ClickHouse, not an entity ORM. ClickHouse is columnar and aggregation-first, so hypequery models measures, dimensions, and time grains rather than entities with relations and lifecycle hooks."
      }
    ]
  },

  {
    slug: 'hypequery-vs-metabase',
    href: '/compare/hypequery-vs-metabase',
    title: 'hypequery vs Metabase',
    verdict:
      'Metabase is a BI tool with an official ClickHouse connector and several ways to embed it: guest embeds on every plan, and modular embedding with SSO, the React SDK and full app embedding on Pro and Enterprise. It is the faster route to charts, especially for internal analytics. hypequery is the code-first route for customer-facing analytics, where queries are typed, tenant rules live in your own auth and the UI is your own React components.',
    alternativeLabel: 'Metabase',
    alternativeName: 'Metabase',
    chooseAlternativeWhen: [
      'Non-engineers need to build and change dashboards themselves, without waiting on a deploy.',
      'The audience is internal: leadership dashboards, ops exploration and ad-hoc questions.',
      'You need charts live this week, and Metabase’s look inside your product is acceptable.',
      'You want alerts and scheduled email or Slack subscriptions without building them.',
      'Guest embeds with tenant filters locked in a signed token cover your isolation needs, and either the “Powered by Metabase” banner is fine or you are on Pro.',
    ],
    rows: [
      {
        label: 'Category',
        hypequery: 'Code-first analytics layer behind your own UI',
        alternative: 'BI tool with an official ClickHouse connector and embedding',
      },
      {
        label: 'Best for',
        hypequery: 'Customer-facing analytics that ships inside your product',
        alternative: 'Internal dashboards and self-serve exploration by non-engineers',
      },
      {
        label: 'Who builds charts',
        hypequery: 'Engineers, in TypeScript or Python plus React',
        alternative: 'Anyone, in the Metabase UI',
      },
      {
        label: 'Embedding',
        hypequery: 'Your own React components on typed hooks',
        alternative: 'Guest embeds on every plan; modular embedding with SSO, the React SDK and full app embedding on Pro and Enterprise',
      },
      {
        label: 'Branding',
        hypequery: 'Your design system',
        alternative: 'Guest embeds show “Powered by Metabase” on Open Source and Starter; Pro and Enterprise remove it',
      },
      {
        label: 'Multi-tenancy',
        hypequery: 'Tenant scope from your app’s auth, injected per request',
        alternative: 'Locked filters in signed guest-embed tokens; row and column security on Pro and Enterprise',
      },
      {
        label: 'Type safety',
        hypequery: 'Types generated from your live ClickHouse schema',
        alternative: 'Questions are authored in the UI, not checked against code',
      },
      {
        label: 'Agents and MCP',
        hypequery: '@hypequery/mcp exposes governed datasets and metrics',
        alternative: 'MCP server on every plan, scoped to the connecting user’s permissions',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source; you pay for your own infrastructure',
        alternative: 'Open Source free; Starter $100/month; Pro $575/month; Enterprise from $20,000/year',
      },
    ],
    faq: [
      {
        question: 'What is Metabase embedding?',
        answer:
          'Metabase offers four ways to put its charts in your app. Guest embeds render a dashboard or question as a web component, authorized by a JWT your server signs. Modular embedding places individual components, such as a dashboard, chart or query builder, using web components or the React SDK, with SSO. Full app embedding puts the whole Metabase app in an iframe. Public links share an item with anyone who has the link. Static embedding is deprecated in favor of guest embeds.',
      },
      {
        question: 'Which Metabase plans include embedding?',
        answer:
          'Guest embeds work on every plan, including Open Source and Starter, where they show a Powered by Metabase banner. Modular embedding with SSO, the React SDK, full app embedding, and row and column security require Pro or Enterprise. Pro is listed at $575 per month with 10 users included, and Enterprise starts at $20,000 per year (checked 8 November 2026).',
      },
      {
        question: 'Can I embed Metabase in a customer-facing SaaS product?',
        answer:
          'Yes. On any plan, guest embeds let your server lock a tenant filter into the signed token, but viewers cannot drill through or use the query builder. For interactive embeds tied to your users, with row and column security from user attributes, you need Pro or Enterprise. Either way the charts are Metabase components and the tenant rules are configured in Metabase.',
      },
      {
        question: 'Is Metabase or hypequery faster to get a first dashboard?',
        answer:
          'Metabase. Connect ClickHouse, build a question, embed it, and a chart can be live in an afternoon with no code. hypequery pays off over time when you need typed queries, tenant rules in your own auth, and UI that matches your product.',
      },
      {
        question: 'What is a good Metabase alternative for embedded analytics?',
        answer:
          'For developers who want analytics to be part of the product rather than an embedded BI tool, a code-first layer works better: hypequery serves typed, tenant-scoped ClickHouse queries as API endpoints and React hooks, and you draw the charts with your own components. If non-engineers must author the dashboards, stay with a BI tool.',
      },
      {
        question: 'Do I have to choose one?',
        answer:
          'No. A common split is Metabase for internal BI and ad-hoc exploration, and hypequery for the customer-facing analytics baked into your product. Both point at the same ClickHouse.',
      },
    ],
  },

  {
    "slug": "hypequery-vs-clickhouse-http",
    "href": "/compare/hypequery-vs-clickhouse-http",
    "title": "hypequery vs the ClickHouse HTTP Interface",
    "verdict": "The ClickHouse HTTP interface is excellent for scripts, health checks, and one-off queries, and it's the transport hypequery uses under the hood. hypequery is the better fit once the same queries live in application code and need types, reuse, and safe parameters.",
    "alternativeLabel": "ClickHouse HTTP interface",
    "alternativeName": "the HTTP interface",
    "chooseAlternativeHeading": "When to use the HTTP interface directly",
    "chooseAlternativeWhen": [
      "Health checks, CI probes and shell scripts where curl is already available.",
      "Ad-hoc exploration, or debugging a query outside your application.",
      "Languages or tools with no ClickHouse client, since any HTTP library works.",
      "One-off exports, using FORMAT CSV or FORMAT Parquet and writing the response straight to a file."
    ],
    "rows": [
      {
        "label": "Best for",
        "hypequery": "Application code that queries ClickHouse at request time",
        "alternative": "Scripts, health checks, one-off queries from the shell"
      },
      {
        "label": "Parameters",
        "hypequery": "Bound parameters via the query builder",
        "alternative": "SQL strings; server-side {name:Type} binding with param_ arguments, wired by hand"
      },
      {
        "label": "Response types",
        "hypequery": "Generated from your schema, correct runtime mappings",
        "alternative": "Untyped JSON you hand-parse and annotate"
      },
      {
        "label": "Reuse",
        "hypequery": "One query definition across execution, HTTP, and React",
        "alternative": "Same query string pasted wherever it's needed"
      },
      {
        "label": "Exposed endpoints",
        "hypequery": "zod validation, auth hooks, OpenAPI via @hypequery/serve",
        "alternative": "You build validation and auth from scratch"
      },
      {
        "label": "Setup",
        "hypequery": "npm packages and a generate step",
        "alternative": "Nothing to install; curl against port 8123, or 8443 over TLS"
      },
      {
        "label": "Rate limits and caching",
        "hypequery": "rateLimit middleware and an optional query result cache",
        "alternative": "Server-side quotas and the ClickHouse query cache, configured on the server"
      }
    ],
    "faq": [
      {
        "question": "Does hypequery replace the ClickHouse HTTP interface?",
        "answer": "No. hypequery builds on @clickhouse/client, which speaks the same HTTP protocol to ClickHouse. It adds generated types, bound parameters, and reusable query definitions on top of the same transport."
      },
      {
        "question": "When should I stick with raw curl over HTTP?",
        "answer": "For health checks, ad-hoc exploration, shell scripts, and CI probes, curl against port 8123 with FORMAT JSON is the right tool. There is nothing to install and nothing to maintain."
      },
      {
        "question": "Is string-concatenated SQL over HTTP a real risk?",
        "answer": "Yes, once user input reaches the query. Interpolating values into a SQL string exposes you to injection and escaping bugs. hypequery's query builder binds parameters and validates inputs before any SQL runs."
      }
    ]
  },

  {
    "slug": "hypequery-vs-raw-sql",
    "href": "/compare/hypequery-vs-raw-sql",
    "title": "hypequery vs Raw SQL",
    "verdict": "Raw SQL strings are the right call for one-off scripts and genuinely gnarly analytical SQL — and hypequery agrees, which is why selectExpr and withCTE let you drop to raw SQL any time. The case for the builder is the repeated, application-embedded queries where hand-written strings and interfaces silently drift from your schema.",
    "alternativeLabel": "Raw SQL",
    "alternativeName": "raw SQL",
    "chooseAlternativeHeading": "When to write raw SQL instead",
    "chooseAlternativeWhen": [
      "One-off backfills, migrations and admin scripts.",
      "Analytical SQL with window functions, ASOF joins or several nested CTEs that reads more clearly as SQL.",
      "Queries that run once and never get reused, filtered or refactored.",
      "SQL owned and reviewed by analysts who work in SQL, not TypeScript."
    ],
    "rows": [
      {
        "label": "Best for",
        "hypequery": "Reused, app-embedded queries that must stay in sync with the schema",
        "alternative": "One-off scripts, migrations, and genuinely gnarly analytical SQL"
      },
      {
        "label": "Schema drift",
        "hypequery": "Rename a column and every affected query fails to compile",
        "alternative": "Nothing fails until the query runs in production"
      },
      {
        "label": "Refactoring",
        "hypequery": "Find-references and rename work across the codebase",
        "alternative": "String search, no IDE support, copy-paste reuse"
      },
      {
        "label": "Injection safety",
        "hypequery": "Parameterized by construction; values never interpolated",
        "alternative": "Safe only if you never interpolate — easy to get wrong"
      },
      {
        "label": "Result types",
        "hypequery": "Generated from the schema, including ClickHouse runtime mappings",
        "alternative": "Interfaces you write and keep in sync by hand"
      },
      {
        "label": "Escape hatch",
        "hypequery": "selectExpr / rawAs / withCTE for the hard parts",
        "alternative": "It is all raw SQL, all the time"
      }
    ],
    "faq": [
      {
        "question": "Is raw SQL ever the right choice over hypequery?",
        "answer": "Yes. For a one-off backfill script, a migration, or a genuinely complex analytical query with window functions and ASOF joins, raw SQL is clearer than any builder. hypequery is aimed at the queries that live in your application and get reused, filtered, and refactored over time — not throwaway SQL."
      },
      {
        "question": "Do I have to give up raw SQL entirely to use hypequery?",
        "answer": "No. hypequery has escape hatches precisely so you never fight the builder: selectExpr and rawAs drop raw SQL expressions into a typed .select(), and .withCTE() takes a raw SQL subquery. You get compile-time safety on the parts the builder covers and raw SQL for the parts it doesn't."
      },
      {
        "question": "How is this different from comparing hypequery to @clickhouse/client?",
        "answer": "This page is about the practice of writing raw SQL strings and hand-written result interfaces wherever they live — template literals, .sql files, any client. The comparison with the official @clickhouse/client is about that specific transport library, which hypequery is actually built on top of."
      },
      {
        "question": "Does the builder cover window functions and FINAL?",
        "answer": "Partly. FINAL, LIMIT BY, CTEs, and array joins are first-class builder methods. Window functions are not — you express them with selectExpr('... OVER (...)', 'alias'). The builder is honest about its edges and hands you raw SQL where it stops."
      }
    ]
  },
  {
    slug: 'hypequery-vs-clickhouse-connect',
    href: '/compare/hypequery-vs-clickhouse-connect',
    title: 'hypequery vs clickhouse-connect',
    verdict:
      'clickhouse-connect is the official Python driver: it runs the SQL you write. hypequery runs on top of it and adds shared measures, request validation, and tenant isolation. Use the driver for raw SQL and inserts, and hypequery for the numbers your product shares.',
    primaryLabel: 'hypequery',
    alternativeLabel: 'clickhouse-connect',
    alternativeName: 'clickhouse-connect',
    chooseAlternativeWhen: [
      'Inserts and ingestion: hypequery’s Python SDK is read-only.',
      'Schema changes, admin scripts and one-off SQL.',
      'Data science on arbitrary SQL, where query_df or query_arrow returns a DataFrame or Arrow table directly.',
      'A single script or notebook where shared measures, validation and tenant isolation add nothing.',
    ],
    rows: [
      {
        label: 'What it is',
        hypequery: 'A semantic layer in Python, built on clickhouse-connect',
        alternative: 'The official ClickHouse Python driver',
      },
      {
        label: 'You write',
        hypequery: 'Datasets: measures, dimensions, tenant key',
        alternative: 'SQL strings with server-side parameters',
      },
      {
        label: 'Tenant isolation',
        hypequery: 'Added to every query; fails closed without a tenant',
        alternative: 'Your responsibility in each query',
      },
      {
        label: 'HTTP and agents',
        hypequery: 'FastAPI endpoints, typed React hooks, MCP bridge',
        alternative: 'None; build your own API',
      },
      {
        label: 'Results',
        hypequery: 'Rows as dicts with decimals and dates as strings; to_pandas(), to_polars() and to_arrow() for analysis',
        alternative: 'Native types, NumPy, pandas, and Arrow for any SQL',
      },
      {
        label: 'Inserts',
        hypequery: 'Not supported; read-only queries',
        alternative: 'Fast bulk inserts',
      },
    ],
    faq: [
      {
        question: 'Does hypequery replace clickhouse-connect?',
        answer:
          'No. hypequery uses clickhouse-connect to talk to ClickHouse. It replaces the analytics SQL you would otherwise write and maintain by hand, not the driver.',
      },
      {
        question: 'When should I use clickhouse-connect directly?',
        answer:
          'For inserts, schema changes, one-off scripts, and data science work where you want `query_df` or Arrow output for arbitrary SQL. Use hypequery when the same measure is queried from several places or by customers.',
      },
      {
        question: 'Can they share a connection?',
        answer:
          'Yes. `ClickHouseExecutor` accepts an existing clickhouse-connect client, so you can reuse one you already create.',
      },
    ],
  },
];

export const comparePageBySlug = Object.fromEntries(comparePages.map((page) => [page.slug, page])) as Record<
  ComparePageConfig['slug'],
  ComparePageConfig
>;
