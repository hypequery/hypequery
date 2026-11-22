import { comparisonPages } from '@/data/comparisons';

// The two decision lines on each /compare card: who the other option suits,
// and when hypequery is the better pick. Each line restates the verdict on the
// linked page, so it carries no claim that page does not already make and source.

export type CompareHubNote = { bestFitFor: string; chooseHypequeryWhen: string };

const notes: Record<string, CompareHubNote> = {
  '/compare/hypequery-vs-clickhouse-client': {
    bestFitFor: 'Scripts, migrations, admin commands and streaming inserts, where a connection and a SQL string are enough.',
    chooseHypequeryWhen: 'Application queries need generated schema types, reusable definitions and a typed API on top of the client.',
  },
  '/compare/hypequery-vs-kysely': {
    bestFitFor: 'General TypeScript query building across Postgres, MySQL and SQLite.',
    chooseHypequeryWhen: 'ClickHouse is the database and you want its runtime type mapping, schema generation and analytics APIs.',
  },
  '/compare/hypequery-vs-drizzle': {
    bestFitFor: 'Transactional TypeScript apps on Postgres, MySQL or SQLite. Drizzle does not support ClickHouse.',
    chooseHypequeryWhen: 'You need a typed query builder and schema generation for a live ClickHouse database.',
  },
  '/compare/hypequery-vs-prisma': {
    bestFitFor: 'Relational app data with migrations and an ORM. Prisma does not support ClickHouse.',
    chooseHypequeryWhen: 'Analytics run on ClickHouse and you want typed queries built around its data model.',
  },
  '/compare/hypequery-vs-typeorm': {
    bestFitFor: 'Entity-based data access on Postgres or MySQL. TypeORM does not support ClickHouse.',
    chooseHypequeryWhen: 'You keep TypeORM for transactional data and need a ClickHouse-native layer beside it.',
  },
  '/compare/hypequery-vs-clickhouse-http': {
    bestFitFor: 'Health checks, scripts and one-off queries over plain HTTP.',
    chooseHypequeryWhen: 'The same queries live in application code and need types, reuse and safe parameters.',
  },
  '/compare/hypequery-vs-raw-sql': {
    bestFitFor: 'One-off scripts and complex analytical SQL you would rather write by hand.',
    chooseHypequeryWhen: 'Queries repeat across your app and hand-written strings keep drifting from the schema.',
  },
  '/compare/hypequery-vs-cube': {
    bestFitFor: 'A central semantic layer service with its own APIs and caching in front of many warehouses.',
    chooseHypequeryWhen: 'Your data is in ClickHouse and you want metrics as code inside your backend, with no extra service.',
  },
  '/compare/hypequery-vs-tinybird': {
    bestFitFor: 'Managed ClickHouse with ingestion and hosted SQL API endpoints, with little backend work.',
    chooseHypequeryWhen: 'Data must stay in your own ClickHouse and the API layer should be code your team owns.',
  },
  '/compare/clickhouse-cloud-vs-tinybird': {
    bestFitFor: 'Choosing where ClickHouse runs: a managed database, or a platform with hosted APIs on top.',
    chooseHypequeryWhen: 'You pick ClickHouse Cloud or self-hosted and still want typed APIs and tenant rules in code.',
  },
  '/compare/cube-vs-tinybird-vs-hypequery': {
    bestFitFor: 'Teams choosing between a semantic layer platform, a managed analytics service and a library.',
    chooseHypequeryWhen: 'You want the API layer as an open-source library in your own codebase.',
  },
  '/compare/hypequery-vs-moose': {
    bestFitFor: 'Nothing new: MooseStack has reached end of life.',
    chooseHypequeryWhen: 'You are moving MooseStack query models, APIs, React hooks or MCP tools to an active project.',
  },
  '/compare/hypequery-vs-dbt': {
    bestFitFor: 'Scheduled transformations inside ClickHouse.',
    chooseHypequeryWhen: 'Applications need the transformed data at request time; many teams run both.',
  },
  '/compare/hypequery-vs-propel': {
    bestFitFor: 'Nothing new: Propel’s addresses point to a domain-parking page.',
    chooseHypequeryWhen: 'You need a typed API layer on a ClickHouse you run.',
  },
  '/compare/hypequery-vs-metabase': {
    bestFitFor: 'Internal dashboards and self-serve exploration by non-engineers, with embedding on every plan.',
    chooseHypequeryWhen: 'The dashboard is part of your product, built from your components, with tenant scope from your own auth.',
  },
  '/compare/hypequery-vs-clickhouse-connect': {
    bestFitFor: 'Raw SQL and inserts from Python with the official driver.',
    chooseHypequeryWhen: 'Python services need shared measures, request validation and tenant isolation on top of it.',
  },
  '/compare/hypequery-vs-clickhouse-agents': {
    bestFitFor: 'A managed chat and agent builder for your own team inside ClickHouse Cloud.',
    chooseHypequeryWhen: 'The agent ships in your product and each customer must only reach their own data.',
  },
  '/compare/embedded-analytics-typescript': {
    bestFitFor: 'TypeScript teams evaluating embedded analytics architectures before picking a vendor.',
    chooseHypequeryWhen: 'Metric governance, tenant isolation and type safety matter more than a visual builder.',
  },
  '/compare/embedded-analytics-platforms': {
    bestFitFor: 'Shortlisting from 15 embedded analytics platforms by embedding method, tenancy and price.',
    chooseHypequeryWhen: 'Engineers build the dashboards and the data is in ClickHouse.',
  },
  '/compare/build-vs-buy-embedded-analytics': {
    bestFitFor: 'Deciding whether to build customer-facing analytics in-house or buy a platform.',
    chooseHypequeryWhen: 'You want to buy the data layer as open source and build only the front end.',
  },
  '/compare/embedded-analytics-pricing': {
    bestFitFor: 'Comparing billing models and a 1,000-viewer scenario across vendors that publish prices.',
    chooseHypequeryWhen: 'Per-viewer or capacity pricing would grow with your customer count.',
  },
  '/compare/luzmo-alternatives': {
    bestFitFor: 'Teams leaving Luzmo, grouped by why they switch.',
    chooseHypequeryWhen: 'The reason is owning the front end and keeping analytics in your repo.',
  },
  '/compare/embeddable-alternatives': {
    bestFitFor: 'Teams leaving Embeddable, grouped by why they switch.',
    chooseHypequeryWhen: 'You want the UI and data layer in your repo, on ClickHouse, without Cube.',
  },
  '/compare/hypequery-vs-embeddable': {
    bestFitFor: 'Engineers writing React components and Cube models that others assemble in a no-code builder.',
    chooseHypequeryWhen: 'Your team builds every dashboard in code and the data is in ClickHouse.',
  },
  '/compare/hypequery-vs-luzmo': {
    bestFitFor: 'Hosted dashboards that product teams or customers edit, across 19 databases.',
    chooseHypequeryWhen: 'Your data is in ClickHouse and you want analytics versioned with your code.',
  },
  '/cube-js-alternative': {
    bestFitFor: 'Comparing semantic layers for embedded analytics and AI agents.',
    chooseHypequeryWhen: 'You want the semantic layer as a library inside your backend, on ClickHouse.',
  },
  '/tinybird-alternative': {
    bestFitFor: 'Teams moving off Tinybird who want to keep a typed API layer.',
    chooseHypequeryWhen: 'Data should stay in your own ClickHouse with no second platform plan.',
  },
};

for (const page of comparisonPages) {
  notes[page.path] = page.hubCard;
}

export function compareHubNote(href: string): CompareHubNote | undefined {
  return notes[href];
}
