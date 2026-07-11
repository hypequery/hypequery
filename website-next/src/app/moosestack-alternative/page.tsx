import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'MooseStack Alternative — The Library Instead of the Framework',
  description:
    'Looking for a MooseStack (Moose) alternative? hypequery gives you typed ClickHouse queries and APIs as an npm library — no framework runtime, no project scaffold, no streaming stack you didn’t ask for.',
  alternates: { canonical: absoluteUrl('/moosestack-alternative') },
  openGraph: {
    images: ogImage('MooseStack Alternative — The Library Instead of the Framework'),
    type: 'website',
    url: absoluteUrl('/moosestack-alternative'),
    title: 'MooseStack Alternative — The Library Instead of the Framework | hypequery',
    description:
      'Moose wants to own your analytical backend. If you just need typed queries and APIs on the ClickHouse you already run, hypequery is the lighter path.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MooseStack Alternative | hypequery',
    description:
      'Typed ClickHouse queries and APIs as a library, not a framework. The lightweight MooseStack alternative.',
  },
};

const generateCode = `# no scaffold, no dev runtime — just point at your ClickHouse
npx @hypequery/cli generate --output ./src/schema.ts

# types follow your live schema, not a schema you re-declare:
# DateTime -> string
# UInt64   -> string
# Nullable -> T | null`;

const queryCode = `import { createQueryBuilder, selectExpr } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
});

const dailyActive = await db
  .table('events')
  .select([selectExpr('toStartOfDay(timestamp)', 'day')])
  .distinctCount('user_id', 'active_users')
  .groupBy('day')
  .orderBy('day', 'DESC')
  .execute();`;

export default function MooseStackAlternativePage() {
  return (
    <ClickhousePillarPage
      eyebrow="MooseStack Alternative"
      title="Looking for a MooseStack alternative?"
      description="Moose is genuinely interesting — and it's a lot. A dev runtime, a project structure, code-owned migrations, optional Redpanda and Temporal. If what brought you here is 'I just want typed queries and APIs on the ClickHouse we already have,' hypequery is that, and only that."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/compare/hypequery-vs-moose', label: 'Read the full comparison' }}
      stats={[
        { label: 'Footprint', value: 'npm library, no runtime' },
        { label: 'Schema', value: 'Introspected, not migrated' },
        { label: 'Best fit', value: 'Existing ClickHouse stacks' },
      ]}
      problems={[
        {
          title: 'Moose is a framework commitment',
          copy:
            'Adopting Moose means its project structure, its dev server, its way of doing things. That’s a fair price for a greenfield analytical backend. It’s a strange one for adding typed queries to an app that already exists.',
        },
        {
          title: 'It wants to own your schema',
          copy:
            'Moose declares tables in code and migrates ClickHouse to match. If your schema is already owned elsewhere — SQL migrations, a data team, dbt — a code-first migration tool is a second driver fighting for the wheel.',
        },
        {
          title: 'The batteries may not be your batteries',
          copy:
            'Streaming via Redpanda and orchestration via Temporal are core Moose modules. Great if you need them. If you already have ingestion and jobs sorted, they are surface area you are carrying but not using.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The alternative',
        title: 'Take the typed layer, skip the framework',
        description:
          'hypequery does the part of Moose most teams actually came for — typed ClickHouse queries and typed APIs in TypeScript — as a dependency in the application you already have.',
        bullets: [
          'Generate types by introspecting your live ClickHouse — your existing schema ownership stays exactly as it is',
          'Write composable, fully typed queries with ClickHouse-aware helpers and raw SQL escape hatches',
          'Serve queries as validated REST endpoints with OpenAPI docs via @hypequery/serve',
          'Consume the same contracts in React through typed hooks',
          'Keep your dev loop: no moose dev, no framework runtime, nothing new to operate',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Introspect instead of migrate',
          description:
            'This is the philosophical difference in one command. Moose pushes schema from code into ClickHouse. hypequery pulls types from ClickHouse into code — whoever owns the schema keeps owning it.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Typed queries in the app you already have',
        description:
          'No new project layout, no framework conventions. Queries are ordinary TypeScript in your existing codebase, typed against the schema that actually exists.',
        paragraphs: [
          'If you are starting an analytical backend from nothing and want streaming, orchestration, and schema management from one tool, Moose is a coherent answer and you should read the full comparison before deciding.',
          'But most teams reading this page aren’t greenfield. They already have a ClickHouse, they already have ingestion, and the missing piece is the typed layer between the database and the product. That’s the whole of what hypequery does — nothing more.',
        ],
        codePanel: {
          eyebrow: 'Step 2',
          title: 'A typical query, no framework attached',
          description:
            'Aggregations, time bucketing, and filters — typed end to end, in a file that lives next to the rest of your application code.',
          code: queryCode,
        },
      }}
      comparisonTable={{
        eyebrow: 'Side by side',
        title: 'Moose vs hypequery at a glance',
        description:
          'Both are open source, TypeScript-first, and ClickHouse-native. The split is framework versus library — and which direction schema flows.',
        competitorLabel: 'Moose (MooseStack)',
        rows: [
          {
            label: 'Model',
            competitor: 'Framework — project scaffold, dev runtime, conventions',
            hypequery: 'Library — npm install into your existing app',
          },
          {
            label: 'Schema',
            competitor: 'Declared in code, migrated into ClickHouse',
            hypequery: 'Introspected from the ClickHouse you already run',
          },
          {
            label: 'Streaming ingest',
            competitor: 'Built in via Kafka/Redpanda',
            hypequery: 'Not included — keep your existing pipeline',
          },
          {
            label: 'Orchestration',
            competitor: 'Built in via Temporal',
            hypequery: 'Not included',
          },
          {
            label: 'Typed query APIs',
            competitor: 'Yes — ingest and query endpoints',
            hypequery: 'Yes — @hypequery/serve with OpenAPI docs',
          },
          {
            label: 'React integration',
            competitor: 'Bring your own',
            hypequery: 'Typed hooks on the same query contract',
          },
          {
            label: 'Local dev',
            competitor: 'moose dev runtime spins up the stack',
            hypequery: 'Nothing new — it is just your app',
          },
          {
            label: 'Adoption cost',
            competitor: 'New structure, new runtime, new conventions',
            hypequery: 'One dependency and a generate command',
          },
        ],
        footnote:
          'Greenfield analytical backend with streaming and jobs? Moose earns its weight. Existing app, existing ClickHouse, missing types? That’s the column on the right.',
      }}
      searchIntentCards={[
        {
          title: 'MooseStack alternative for existing ClickHouse',
          copy:
            'hypequery is built for exactly this case: ClickHouse already runs, ingestion already works, and the missing piece is typed queries and APIs. No migration of schema ownership required.',
        },
        {
          title: 'Moose without the framework',
          copy:
            'The part of Moose most product teams want is Moose OLAP’s typed queries. hypequery delivers that as a standalone library, without the dev runtime, streaming, or workflow modules.',
        },
        {
          title: 'Typed ClickHouse queries in TypeScript',
          copy:
            'Types generated from your live schema, a composable query builder, and compile-time safety on every column reference — the core workflow, minus the scaffold.',
        },
        {
          title: 'When Moose is the right call',
          copy:
            'Building from scratch and want ingest, schema, transformations, and APIs in one coherent tool? Moose is a real answer. This page is for everyone whose backend already exists.',
        },
      ]}
      readingLinks={[
        {
          href: '/compare/hypequery-vs-moose',
          title: 'hypequery vs Moose',
          description: 'The full comparison — schema direction, scope, and where each tool genuinely wins.',
        },
        {
          href: '/clickhouse-schema',
          title: 'ClickHouse schema generation',
          description: 'How live-schema introspection turns into TypeScript types that match runtime values.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'How @hypequery/serve turns query definitions into validated, documented endpoints.',
        },
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'The broader workflow for reusable queries, HTTP APIs, and runtime type safety.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/cube-js-alternative', label: 'Cube.js Alternative' },
        { href: '/tinybird-alternative', label: 'Tinybird Alternative' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Run generate against your ClickHouse and write one query',
        description:
          'Ten minutes, no scaffold. If the typed layer is all you needed, you will know immediately.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/compare/hypequery-vs-moose', label: 'Read full comparison' },
      }}
    />
  );
}
