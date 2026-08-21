import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'MooseStack EOL Alternative for ClickHouse',
  description:
    'MooseStack has reached end of life. Migrate typed ClickHouse queries, semantic metrics, APIs, React hooks, and MCP tools to hypequery.',
  alternates: { canonical: absoluteUrl('/moosestack-alternative') },
  openGraph: {
    images: ogImage('MooseStack EOL Alternative for ClickHouse'),
    type: 'website',
    url: absoluteUrl('/moosestack-alternative'),
    title: 'MooseStack EOL Alternative | hypequery',
    description:
      'MooseStack is no longer actively maintained. Move its application-facing ClickHouse analytics layer to actively maintained TypeScript packages.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MooseStack EOL Alternative | hypequery',
    description:
      'A practical replacement for MooseStack typed ClickHouse queries and APIs.',
  },
};

const generateCode = `# Generate types from the ClickHouse you already run
npm install -D @hypequery/cli
npx hypequery generate

# Then migrate one read query at a time
npx hypequery dev --open`;

const queryCode = `const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .where('status', 'eq', 'completed')
  .sum('amount', 'revenue')
  .groupBy('region')
  .orderBy('revenue', 'DESC')
  .execute();`;

export default function MooseStackAlternativePage() {
  return (
    <ClickhousePillarPage
      eyebrow="MooseStack EOL Alternative"
      title="MooseStack is end of life. Here is the migration path."
      description="MooseStack’s maintainers say the project is no longer actively maintained, and its GitHub repository is archived. hypequery replaces the typed ClickHouse query, semantic, API, React, and MCP layer while letting dedicated tools own schema, streaming, and workflows."
      primaryCta={{
        href: '/blog/migrating-moosestack-to-hypequery',
        label: 'Open the migration guide',
      }}
      secondaryCta={{
        href: 'https://github.com/514-labs/moosestack#readme',
        label: 'Read the official EOL statement',
      }}
      stats={[
        { label: 'MooseStack status', value: 'End of life' },
        { label: 'hypequery model', value: 'Open-source TypeScript' },
        { label: 'Migration style', value: 'Incremental' },
      ]}
      problems={[
        {
          title: 'An archived framework is not a new production dependency',
          copy:
            'MooseStack can keep running while you migrate, but new features and long-term application contracts need an actively maintained home.',
        },
        {
          title: 'Moose covered more than one job',
          copy:
            'Typed queries, DDL, Redpanda ingestion, Temporal workflows, APIs, and agent tooling should not be moved in one risky cutover.',
        },
        {
          title: 'The query layer can move first',
          copy:
            'Read-only ClickHouse queries and semantic metrics are the cleanest boundary to migrate and verify while existing infrastructure keeps running.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The replacement boundary',
        title: 'Move product analytics without rebuilding the data plane',
        description:
          'hypequery gives the application an actively maintained, type-safe ClickHouse layer. Keep or replace ingestion, workflows, and DDL on their own timelines.',
        bullets: [
          'Generate TypeScript types from the live ClickHouse schema',
          'Port and compare read queries one endpoint at a time',
          'Define shared dimensions, measures, metrics, and tenant rules in code',
          'Serve validated APIs and OpenAPI from your existing application',
          'Reuse contracts in React hooks and governed MCP tools',
        ],
        codePanel: {
          eyebrow: 'Step 1',
          title: 'Start from live ClickHouse',
          description:
            'Physical schema stays with the migration system you choose. hypequery introspects the result and protects application queries with generated types.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Step 2',
        title: 'Migrate one query, prove parity, repeat',
        description:
          'The old and new clients can coexist. Compare generated SQL and results before moving traffic, then promote shared calculations into datasets and metrics.',
        paragraphs: [
          'Use @hypequery/clickhouse for typed reads, @hypequery/datasets for shared meaning and tenant scope, and @hypequery/serve when the contract needs HTTP.',
          'Assign Moose OLAP DDL, Redpanda, and Temporal responsibilities to explicit tools before removing the old runtime.',
        ],
        codePanel: {
          eyebrow: 'Typed read',
          title: 'A query inside your existing app',
          description:
            'The result is inferred from the live schema, while filters and aggregations remain ClickHouse-native.',
          code: queryCode,
        },
      }}
      comparisonTable={{
        eyebrow: 'Migration map',
        title: 'What moves to hypequery—and what does not',
        description:
          'This is a responsibility map, not a comparison between two active projects.',
        competitorLabel: 'MooseStack at EOL',
        rows: [
          {
            label: 'Project status',
            competitor: 'End of life; repository archived',
            hypequery: 'Actively maintained open-source packages',
          },
          {
            label: 'Typed queries',
            competitor: 'Existing Moose query code',
            hypequery: '@hypequery/clickhouse',
          },
          {
            label: 'Semantic metrics',
            competitor: 'Moose data models and APIs',
            hypequery: '@hypequery/datasets',
          },
          {
            label: 'HTTP and frontend',
            competitor: 'Moose query endpoints',
            hypequery: '@hypequery/serve and @hypequery/react',
          },
          {
            label: 'Agent access',
            competitor: 'Moose development harness',
            hypequery: 'Governed @hypequery/mcp tools',
          },
          {
            label: 'DDL, streaming, workflows',
            competitor: 'Moose OLAP, Redpanda, and Temporal modules',
            hypequery: 'Keep or choose dedicated tools',
          },
        ],
        footnote:
          'Do not remove Moose until traffic, DDL, ingestion, jobs, and deployment dependencies have all been inventoried.',
      }}
      searchIntentCards={[
        {
          title: 'MooseStack end of life',
          copy:
            'The official GitHub README states that MooseStack has reached end of life and is no longer actively maintained.',
        },
        {
          title: 'MooseStack migration guide',
          copy:
            'The migration guide separates physical schema, streaming, workflows, typed queries, APIs, React, and agents into safe stages.',
        },
        {
          title: 'Typed ClickHouse replacement',
          copy:
            'hypequery covers the application-facing TypeScript layer with generated schema types and ClickHouse-native queries.',
        },
        {
          title: 'Governed AI-agent analytics',
          copy:
            'Expose approved datasets and metrics through MCP instead of handing agents raw ClickHouse credentials.',
        },
      ]}
      readingLinks={[
        {
          href: '/blog/migrating-moosestack-to-hypequery',
          title: 'MooseStack migration guide',
          description: 'The staged technical and organisational cutover.',
        },
        {
          href: '/compare/hypequery-vs-moose',
          title: 'hypequery vs MooseStack after EOL',
          description: 'The current status and responsibility comparison.',
        },
        {
          href: '/docs/capabilities',
          title: 'Current hypequery capabilities',
          description: 'The shipped builder, semantic, Serve, React, and MCP surface.',
        },
        {
          href: '/docs/quick-start',
          title: 'Quick start',
          description: 'Test one real ClickHouse table before planning the cutover.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-tenant Analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Inventory Moose responsibilities, then port one read query',
        description:
          'Prove the typed ClickHouse path against production-shaped data before committing to the rest of the migration.',
        primaryCta: {
          href: '/blog/migrating-moosestack-to-hypequery',
          label: 'Open migration guide',
        },
        secondaryCta: {
          href: '/docs/quick-start',
          label: 'Run the quick start',
        },
      }}
    />
  );
}
