export type ComparePageConfig = {
  slug: 'hypequery-vs-clickhouse-client' | 'hypequery-vs-kysely';
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
    title: 'Quick comparison: hypequery vs @clickhouse/client',
    verdict:
      '@clickhouse/client is the right low-level client. hypequery is the better fit when you need generated schema types, reusable query definitions, typed APIs, and frontend consumption on top of ClickHouse.',
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
    title: 'Quick comparison: hypequery vs Kysely',
    verdict:
      'Kysely is an excellent general TypeScript query builder. hypequery is narrower: it is built for ClickHouse runtime type mapping, schema generation, and reusable analytics APIs.',
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
];

export const comparePageBySlug = Object.fromEntries(comparePages.map((page) => [page.slug, page])) as Record<
  ComparePageConfig['slug'],
  ComparePageConfig
>;
