export type ComparePageConfig = {
  slug:
    | 'hypequery-vs-clickhouse-client'
    | 'hypequery-vs-kysely'
    | 'hypequery-vs-drizzle'
    | 'hypequery-vs-prisma'
    | 'hypequery-vs-cube'
    | 'hypequery-vs-tinybird';
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
];

export const comparePageBySlug = Object.fromEntries(comparePages.map((page) => [page.slug, page])) as Record<
  ComparePageConfig['slug'],
  ComparePageConfig
>;
