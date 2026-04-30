import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Schema — TypeScript Types Generated from Your Database | hypequery',
  description:
    'Generate TypeScript types from your live ClickHouse schema so query code stops relying on hand-written interfaces and incorrect runtime assumptions.',
  alternates: { canonical: absoluteUrl('/clickhouse-schema') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-schema'),
    title: 'ClickHouse Schema — TypeScript Types from Your Database | hypequery',
    description:
      'Stop hand-writing ClickHouse TypeScript interfaces. hypequery generates correct schema types from your live database — including ClickHouse-specific type mappings.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Schema Generation for TypeScript | hypequery',
    description:
      'Generate TypeScript types from your live ClickHouse schema. Correct mappings for DateTime, UInt64, Nullable, and Decimal — automatically.',
  },
};

const generateCode = `# introspect your live ClickHouse schema and generate TypeScript types
npx @hypequery/cli generate \\
  --host your-clickhouse-host \\
  --port 8123 \\
  --database analytics \\
  --output ./src/schema.ts`;

const outputCode = `// generated schema.ts — always reflects your live ClickHouse schema

export interface DB {
  orders: {
    id: string;           // UUID → string
    total: string;        // Decimal(18,4) → string (preserves precision)
    created_at: string;   // DateTime → string (ClickHouse format)
    tenant_id: string;    // String
    status: string;       // LowCardinality(String) → string
    user_id: string | null; // Nullable(String) → string | null
    quantity: number;     // UInt32 → number
    amount: string;       // UInt64 → string (avoids JS precision loss)
  };
  events: {
    event_name: string;
    occurred_at: string;
    properties: string;   // JSON → string
    session_id: string | null;
  };
}`;

export default function ClickHouseSchemaPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Schema"
      title="Generate TypeScript types from your live ClickHouse schema"
      description="This is the page for the first problem most TypeScript teams hit on ClickHouse: the database returns one thing, their interfaces claim another, and the compiler happily trusts the wrong version. hypequery fixes that at the schema boundary."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/docs/schemas', label: 'Read the schemas guide' }}
      stats={[
        { label: 'Command', value: 'npx @hypequery/cli generate' },
        { label: 'Type source', value: 'Live ClickHouse database' },
        { label: 'Update strategy', value: 'Re-run after schema changes' },
      ]}
      problems={[
        {
          title: 'ClickHouse runtime types are easy to misread',
          copy:
            'DateTime is not a JavaScript Date. UInt64 is often not a safe number. Nullable columns change the shape again. If you guess these mappings in an interface, the compiler cannot tell you that the guess is wrong.',
        },
        {
          title: 'Manual interfaces become stale immediately',
          copy:
            'A renamed column or changed type means updating interfaces by hand, then hoping every cast and helper stayed aligned. That is fragile even on a small team.',
        },
        {
          title: 'Raw clients push the typing problem downstream',
          copy:
            'If the client gives you `any[]`, somebody still has to decide what the rows look like. That usually ends in a cast, which means the most important boundary in the system is left unchecked.',
        },
      ]}
      solutionSection={{
        eyebrow: 'What generate actually does',
        title: 'Read the live schema and write the TypeScript file you would not maintain by hand',
        description:
          'The `generate` command introspects the live ClickHouse schema and writes a database interface you can import everywhere else. The value is not that a file appears. The value is that query code now starts from the same source of truth as the database.',
        bullets: [
          'Reads schema from your live ClickHouse information_schema',
          'Correct mappings: DateTime→string, UInt64→string, Nullable(T)→T|null, Decimal→string',
          'Outputs a typed DB interface for every table in the target database',
          'Re-run after any schema change to keep types in sync',
          'Works with ClickHouse Cloud, self-hosted, and local instances',
        ],
        codePanel: {
          eyebrow: 'Generate command',
          title: 'Point the CLI at the real database',
          description:
            'This is the only manual step. After that, the generated file becomes the type source for the query builder and the rest of the TypeScript layer.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'What you get back',
        title: 'A schema file that reflects runtime reality',
        description:
          'The generated output matters because it becomes boring infrastructure: import it once, build queries against it, and let TypeScript flag the places that no longer match after a schema change.',
        paragraphs: [
          'The mappings follow ClickHouse runtime behavior rather than wishful TypeScript shapes. That is why `UInt64` stays a string and why `DateTime` does not become `Date` automatically.',
          'Once this file exists, the rest of the tooling gets simpler: autocomplete is better, casts disappear, and query edits stop feeling like blind string manipulation.',
        ],
        codePanel: {
          eyebrow: 'Generated schema',
          title: 'The kind of file you import everywhere else',
          description:
            'This is the useful artifact: a database-shaped interface that matches what ClickHouse actually returns, not what a relational ORM would prefer it to return.',
          code: outputCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Why this matters more than nicer query syntax',
          copy:
            'If the schema types are wrong, every nicer abstraction above them is built on sand. Fixing the type source is usually a better first move than introducing more wrappers.',
        },
        {
          title: 'What teams usually automate next',
          copy:
            'Most teams rerun generation after schema changes or in CI so type drift gets caught before application code is merged.',
        },
        {
          title: 'What this page is not about',
          copy:
            'This is not a migrations page and it is not an ORM page. It is the narrow piece that keeps runtime ClickHouse shapes and TypeScript expectations aligned.',
        },
        {
          title: 'Where to go after this',
          copy:
            'Once the schema file exists, the next pages that matter are the query builder and TypeScript workflow pages. That is where the generated types start paying off in everyday code.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/schemas',
          title: 'Schemas guide',
          description: 'The full reference for schema generation — options, configuration, and the complete type mapping table.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description: 'How the generated schema types power the composable query builder.',
        },
        {
          href: '/blog/clickhouse-typescript-type-problem',
          title: 'The ClickHouse TypeScript type problem',
          description: 'Why DateTime, UInt64, Nullable, and Decimal return the wrong types and how schema generation fixes it.',
        },
        {
          href: '/clickhouse-migrations',
          title: 'ClickHouse Migrations',
          description: 'Schema change tooling coming soon — reversible migrations with automatic type regeneration.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-migrations', label: 'ClickHouse Migrations' },
        { href: '/clickhouse-orm', label: 'ClickHouse ORM' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Run generate against a real ClickHouse database',
        description:
          'Do it on the schema you already have, then inspect the generated file. You will know quickly whether it removes the casts and wrong assumptions your current code relies on.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
