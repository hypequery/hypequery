export type ComparePageConfig = {
  slug:
    | 'hypequery-vs-clickhouse-client'
    | 'hypequery-vs-kysely'
    | 'hypequery-vs-drizzle'
    | 'hypequery-vs-prisma'
    | 'hypequery-vs-cube'
    | 'hypequery-vs-tinybird'
    | 'cube-vs-tinybird-vs-hypequery'
    | 'hypequery-vs-moose'
    | 'hypequery-vs-dbt'
    | 'hypequery-vs-propel'
    | 'hypequery-vs-typeorm'
    | 'hypequery-vs-metabase'
    | 'hypequery-vs-clickhouse-http'
    | 'hypequery-vs-raw-sql';
  href: string;
  title: string;
  verdict: string;
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
    rows: [
      {
        label: 'Best for',
        hypequery: 'Type-safe analytics layers and app backends',
        alternative: 'Direct ClickHouse access and raw queries',
      },
      {
        label: 'Type safety',
        hypequery: 'Generated from your ClickHouse schema',
        alternative: 'Manual response annotations',
      },
      {
        label: 'Reuse',
        hypequery: 'One query definition across local execution, HTTP, and React',
        alternative: 'You build the abstraction yourself',
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
          'Stay with the official client for one-off scripts, inserts, streaming, or cases where raw SQL control is the main requirement.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-kysely',
    href: '/compare/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    verdict:
      'Kysely is an excellent general TypeScript query builder. hypequery is narrower and more opinionated around ClickHouse runtime type mapping, schema generation, and reusable analytics APIs.',
    rows: [
      {
        label: 'Best for',
        hypequery: 'ClickHouse-first TypeScript analytics',
        alternative: 'General SQL query building, especially Postgres',
      },
      {
        label: 'Schema source',
        hypequery: 'Generated from live ClickHouse schema',
        alternative: 'Usually hand-maintained TypeScript interfaces',
      },
      {
        label: 'Application layer',
        hypequery: 'Query builder, HTTP serving, OpenAPI, React hooks',
        alternative: 'Query builder only',
      },
    ],
    faq: [
      {
        question: 'Can Kysely work with ClickHouse?',
        answer:
          'Yes, but you still need to handle ClickHouse-specific runtime type mappings and application-level reuse yourself.',
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
    rows: [
      {
        label: 'ClickHouse support',
        hypequery: 'Native — built specifically for ClickHouse',
        alternative: 'Not supported — Postgres, MySQL, SQLite only',
      },
      {
        label: 'Schema source',
        hypequery: 'Generated from live ClickHouse schema',
        alternative: 'Defined in TypeScript, pushed to database',
      },
      {
        label: 'Analytics layer',
        hypequery: 'Query builder, HTTP serving, OpenAPI, React hooks',
        alternative: 'Query builder only — no analytics serving layer',
      },
    ],
    faq: [
      {
        question: 'Does Drizzle support ClickHouse?',
        answer:
          'Drizzle does not list ClickHouse as a supported database. hypequery is the dedicated TypeScript-first alternative for ClickHouse workloads.',
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
    rows: [
      {
        label: 'ClickHouse support',
        hypequery: 'Native — built specifically for ClickHouse',
        alternative: 'Not supported — Postgres and MySQL only',
      },
      {
        label: 'Schema approach',
        hypequery: 'Introspect live ClickHouse database → generate types',
        alternative: 'Define schema in Prisma schema file → generate client',
      },
      {
        label: 'Query layer',
        hypequery: 'Analytics-optimised query builder with ClickHouse-native syntax',
        alternative: 'Relational ORM — tables, relations, transactions',
      },
    ],
    faq: [
      {
        question: 'Does Prisma support ClickHouse?',
        answer:
          'No. Prisma is designed for relational transactional databases — Postgres, MySQL, SQLite. ClickHouse has a fundamentally different data model that Prisma does not support.',
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
      'Cube is a semantic layer platform for centralized metrics. hypequery is a lighter code-first TypeScript layer for product engineers building ClickHouse-backed features. They solve different problems.',
    rows: [
      {
        label: 'Best for',
        hypequery: 'Product engineers building ClickHouse features in TypeScript',
        alternative: 'Centralised metrics for BI tools and multiple consumers',
      },
      {
        label: 'Setup',
        hypequery: 'npm install — no separate infrastructure',
        alternative: 'Separate Cube server, Redis cache, config management',
      },
      {
        label: 'Workflow',
        hypequery: 'Fully code-first — lives in your TypeScript codebase',
        alternative: 'Config-first YAML/JS schema outside your app codebase',
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
          'Yes — some teams use Cube for the data team and BI layer, and hypequery for product-facing analytics features where TypeScript integration and engineering velocity matter more.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-tinybird',
    href: '/compare/hypequery-vs-tinybird',
    title: 'hypequery vs Tinybird',
    verdict:
      'Tinybird is a managed ClickHouse platform with a built-in API layer. hypequery is the better fit when your data needs to stay in your own infrastructure and your team wants TypeScript-first, schema-generated types with full code ownership.',
    rows: [
      {
        label: 'Infrastructure',
        hypequery: 'Bring your own ClickHouse',
        alternative: 'Managed ClickHouse platform',
      },
      {
        label: 'TypeScript types',
        hypequery: 'Generated from your live schema',
        alternative: 'Manual — call HTTP endpoints yourself',
      },
      {
        label: 'Code ownership',
        hypequery: 'Queries live in your TypeScript codebase',
        alternative: 'SQL Pipes defined in Tinybird UI',
      },
      {
        label: 'Data location',
        hypequery: 'Stays in your own infrastructure',
        alternative: 'Ingested into Tinybird managed platform',
      },
      {
        label: 'Pricing',
        hypequery: 'Free and open source',
        alternative: 'Based on data processed and API calls',
      },
    ],
    faq: [
      {
        question: 'Does hypequery replace Tinybird?',
        answer:
          'Not directly — they solve the same problem differently. Tinybird is a managed platform that handles ClickHouse infrastructure, auth, and caching for you. hypequery is a TypeScript library you add to your own project, assuming you already run ClickHouse. If you want zero ops and are comfortable with your data living in a third-party platform, Tinybird is compelling. If you want data sovereignty, schema-generated TypeScript types, and code-first control, hypequery is the better fit.',
      },
      {
        question: 'When should I choose Tinybird over hypequery?',
        answer:
          'Choose Tinybird when you have no ops team to manage ClickHouse, need a fast path from raw data to a public API, and data residency or vendor lock-in are not concerns. It is also a good fit when your team is more SQL-fluent than TypeScript-fluent and you want built-in rate limiting and caching without writing any middleware.',
      },
    ],
  },
  {
    slug: 'cube-vs-tinybird-vs-hypequery',
    href: '/compare/cube-vs-tinybird-vs-hypequery',
    title: 'Cube vs Tinybird vs hypequery',
    verdict:
      'Cube, Tinybird, and hypequery all put an API layer between ClickHouse and applications, but they have different shapes: semantic layer platform, managed analytics service, and open-source TypeScript library.',
    rows: [
      {
        label: 'Shape',
        hypequery: 'Open-source TypeScript library inside your app',
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
        hypequery: 'TypeScript product teams with an existing ClickHouse',
        alternative: 'Cube for shared BI semantics; Tinybird for zero-ops hosted analytics APIs',
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
          'Choose hypequery when you already run ClickHouse and want schema-generated TypeScript types, query definitions, and served endpoints inside your own application codebase.',
      },
    ],
  },
  {
    slug: 'hypequery-vs-moose',
    href: '/compare/hypequery-vs-moose',
    title: 'hypequery vs Moose (MooseStack)',
    verdict:
      'MooseStack has reached end of life and its GitHub repository is archived. Do not start a new production system on it. hypequery is the active, narrower replacement for typed ClickHouse queries, semantic metrics, APIs, React hooks, and MCP tools.',
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
        hypequery: 'Actively maintained TypeScript packages inside your application',
        alternative: 'Archived framework code can inform migration but should not be a new dependency',
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
          'No. MooseStack’s maintainers announced end of life and archived the repository. Use the historical architecture as migration context, not as a new production dependency.',
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
      'dbt transforms data inside ClickHouse on a schedule. hypequery serves ClickHouse data to applications at request time with generated TypeScript types. Most teams comparing them are really deciding where the transformation boundary sits — and many end up using both.',
    rows: [
      {
        label: 'Job',
        hypequery: 'Runtime queries and typed APIs for application code',
        alternative: 'Scheduled SQL transformations inside the warehouse',
      },
      {
        label: 'Language',
        hypequery: 'TypeScript with schema-generated types',
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
      'Propel is a serverless analytics platform: managed APIs, a semantic layer, and embeddable UI components on top of ClickHouse. hypequery is the code-first version of the same idea — you keep the ClickHouse you run, and the API layer lives in your TypeScript repo instead of a platform.',
    rows: [
      {
        label: 'Best for',
        hypequery: 'TypeScript teams who want to own the analytics layer as code',
        alternative: 'Teams who want managed APIs and drop-in dashboard components',
      },
      {
        label: 'Model',
        hypequery: 'Open-source library inside your app',
        alternative: 'Serverless platform with GraphQL and SQL APIs',
      },
      {
        label: 'TypeScript types',
        hypequery: 'Generated from your live ClickHouse schema',
        alternative: 'GraphQL codegen against Propel’s API schema',
      },
      {
        label: 'Pricing',
        hypequery: 'Free — you pay for your own infrastructure',
        alternative: 'Usage-based platform pricing',
      },
    ],
    faq: [
      {
        question: 'Is Propel the same thing as Tinybird?',
        answer:
          'They compete in the same space — managed analytics APIs over ClickHouse — but Propel leans harder into embedded analytics: a semantic layer, multi-tenant access policies, and embeddable React UI components. Tinybird leans into ingestion and SQL Pipes. hypequery differs from both by being a library rather than a platform.',
      },
      {
        question: 'When should I choose Propel over hypequery?',
        answer:
          'Choose Propel when speed to a customer-facing dashboard matters more than owning the stack — its managed APIs and prebuilt UI components get embedded analytics live very quickly, and it can connect to your existing ClickHouse rather than requiring ingestion.',
      },
      {
        question: 'When is hypequery the better fit?',
        answer:
          'When you want analytics queries versioned in your own repo, response types generated from your actual schema, no per-query platform pricing, and no dependency on a third-party serving layer between your app and your ClickHouse.',
      },
    ],
  },

  {
    "slug": "hypequery-vs-typeorm",
    "href": "/compare/hypequery-vs-typeorm",
    "title": "hypequery vs TypeORM",
    "verdict": "TypeORM does not support ClickHouse and has no credible workaround — its entity/decorator model is built for transactional row stores, not columnar append-only analytics. hypequery is the ClickHouse-native TypeScript layer; the realistic setup is coexistence, with TypeORM on Postgres/MySQL and hypequery on the ClickHouse side.",
    "rows": [
      {
        "label": "ClickHouse support",
        "hypequery": "Native — built specifically for ClickHouse",
        "alternative": "None — Postgres, MySQL, SQLite, and other OLTP engines only"
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
    "slug": "hypequery-vs-metabase",
    "href": "/compare/hypequery-vs-metabase",
    "title": "hypequery vs Metabase",
    "verdict": "Metabase is a BI tool with a ClickHouse connector and iframe/interactive embedding — the fastest way to get a chart in front of people, especially for internal analytics. hypequery is the code-first route for customer-facing product analytics, where you need type-safe queries, per-tenant governance in your own auth stack, and UI built from your own components.",
    "rows": [
      {
        "label": "Category",
        "hypequery": "Code-first embedded analytics library",
        "alternative": "BI tool with a ClickHouse connector and embeds"
      },
      {
        "label": "Best for",
        "hypequery": "Customer-facing product analytics you ship and own",
        "alternative": "Internal dashboards and fast chart-in-front-of-people"
      },
      {
        "label": "The UI",
        "hypequery": "Your own React components on typed contracts",
        "alternative": "Metabase's charts, embedded via iframe or SDK"
      },
      {
        "label": "Multi-tenancy",
        "hypequery": "Tenant rules in your app's auth context, per request",
        "alternative": "Sandboxing / row-level permissions (paid tiers)"
      },
      {
        "label": "Type safety",
        "hypequery": "Types generated from your live ClickHouse schema",
        "alternative": "Not code — queries authored in the BI UI"
      }
    ],
    "faq": [
      {
        "question": "Is Metabase or hypequery faster to get a first dashboard?",
        "answer": "Metabase, clearly. Connect ClickHouse, build a question, publish an embed, and a chart is live in an afternoon with no code. hypequery is faster over the long run only when you need typed queries, per-tenant governance, and UI that matches your product."
      },
      {
        "question": "Can I embed Metabase in a customer-facing SaaS product?",
        "answer": "Yes, with caveats. Static iframe embeds are free; interactive embedding with SSO and row-level sandboxing is a paid tier. The UI is still Metabase's look and feel, and per-tenant rules live in Metabase rather than your own auth stack."
      },
      {
        "question": "Do I have to choose one?",
        "answer": "No. A common split is Metabase for internal BI and ad-hoc exploration, and hypequery for the customer-facing analytics baked into your product. Both point at the same ClickHouse."
      }
    ]
  },

  {
    "slug": "hypequery-vs-clickhouse-http",
    "href": "/compare/hypequery-vs-clickhouse-http",
    "title": "hypequery vs the ClickHouse HTTP Interface",
    "verdict": "The ClickHouse HTTP interface is excellent for scripts, health checks, and one-off queries, and it's the transport hypequery uses under the hood. hypequery is the better fit once the same queries live in application code and need types, reuse, and safe parameters.",
    "rows": [
      {
        "label": "Best for",
        "hypequery": "Application code that queries ClickHouse at request time",
        "alternative": "Scripts, health checks, one-off queries from the shell"
      },
      {
        "label": "Parameters",
        "hypequery": "Bound parameters via the query builder",
        "alternative": "String-concatenated SQL you escape yourself"
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
];

export const comparePageBySlug = Object.fromEntries(comparePages.map((page) => [page.slug, page])) as Record<
  ComparePageConfig['slug'],
  ComparePageConfig
>;
