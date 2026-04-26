import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Schema — TypeScript Types Generated from Your Database | hypequery',
  description:
    'Generate TypeScript types directly from your live ClickHouse schema. hypequery introspects every table and column and outputs correct type mappings for DateTime, UInt64, Nullable, and Decimal.',
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
      description="Hand-written TypeScript interfaces for ClickHouse drift. DateTime is not a Date, UInt64 is not a number, and Nullable columns behave differently to what TypeScript assumes. hypequery introspects your live ClickHouse database and generates correct type mappings for every table and column — automatically."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/docs/schemas', label: 'Read the schemas guide' }}
      stats={[
        { label: 'Command', value: 'npx @hypequery/cli generate' },
        { label: 'Type source', value: 'Live ClickHouse database' },
        { label: 'Update strategy', value: 'Re-run after schema changes' },
      ]}
      problems={[
        {
          title: 'ClickHouse types do not map to TypeScript cleanly',
          copy:
            'DateTime returns as a string formatted as "YYYY-MM-DD HH:MM:SS" — not a JS Date. UInt64 returns as a string to avoid precision loss beyond Number.MAX_SAFE_INTEGER. Nullable(T) returns T | null. If you hand-write interfaces, you are guessing — and TypeScript trusts you.',
        },
        {
          title: 'Hand-written interfaces drift after every schema change',
          copy:
            'Every ALTER TABLE, every new column, every type change means manually updating TypeScript interfaces. On a team moving fast on ClickHouse, the interfaces are almost always slightly wrong — and the bugs are silent until runtime.',
        },
        {
          title: 'Generic types like any and unknown kill the value of TypeScript',
          copy:
            'When @clickhouse/client returns any[], teams either cast to interfaces they wrote by hand or give up on types entirely. Both options mean TypeScript is not actually protecting you from the mistakes it exists to catch.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How schema generation works',
        title: 'One command — correct types for every table and column',
        description:
          'hypequery connects to your live ClickHouse instance and reads the schema from information_schema. It maps each ClickHouse type to the correct TypeScript type using the same rules the ClickHouse JS client follows at runtime — so the types actually match what comes back.',
        bullets: [
          'Reads schema from your live ClickHouse information_schema',
          'Correct mappings: DateTime→string, UInt64→string, Nullable(T)→T|null, Decimal→string',
          'Outputs a typed DB interface for every table in the target database',
          'Re-run after any schema change to keep types in sync',
          'Works with ClickHouse Cloud, self-hosted, and local instances',
        ],
        codePanel: {
          eyebrow: 'Generate command',
          title: 'Introspect your live ClickHouse schema',
          description:
            'Point the CLI at your ClickHouse instance. It reads the schema and outputs a TypeScript interface file. Run it in CI after any schema migration to keep types in sync automatically.',
          code: generateCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Generated output',
        title: 'Correct ClickHouse-to-TypeScript type mappings',
        description:
          'The generated schema file reflects exactly what ClickHouse returns at runtime. No guessing, no hand-writing, no drift. When you add a column or change a type, re-run generate and TypeScript catches every affected query at compile time.',
        paragraphs: [
          'The type mappings are not arbitrary. They follow the same rules as @clickhouse/client — UInt64 comes back as a string because JavaScript cannot represent it precisely as a number. DateTime comes back as a string because ClickHouse uses its own format.',
          'Once the schema is generated, the query builder uses it to provide autocomplete on table names, column names, and return value types across your entire codebase.',
        ],
        codePanel: {
          eyebrow: 'Generated schema',
          title: 'TypeScript types reflecting your live ClickHouse database',
          description:
            'Every column has the correct TypeScript type — matching what ClickHouse actually returns at runtime. Nullable columns are T | null. UInt64 columns are string. No surprises.',
          code: outputCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse TypeScript type generation',
          copy:
            'hypequery generate is the only tool that introspects a live ClickHouse schema and outputs correct TypeScript type mappings. It handles the DateTime, UInt64, Nullable, and Decimal cases that hand-written interfaces get wrong.',
        },
        {
          title: 'ClickHouse schema introspection',
          copy:
            'The generate command reads from information_schema — the same source ClickHouse uses internally. Every table, every column, every type — mapped to TypeScript and written to a file you commit alongside your code.',
        },
        {
          title: 'Keep TypeScript types in sync with ClickHouse schema',
          copy:
            'The standard workflow is to re-run generate in CI after any schema change. This makes TypeScript the last line of defence against using a column that no longer exists or expecting the wrong type from a changed column.',
        },
        {
          title: 'ClickHouse column type TypeScript mapping',
          copy:
            'The full type mapping: String→string, UInt8/16/32→number, UInt64→string, Int8/16/32→number, Int64→string, Float32/64→number, Decimal→string, DateTime→string, Date→string, Boolean→boolean, Nullable(T)→T|null, Array(T)→T[].',
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
        title: 'Generate TypeScript types from your ClickHouse schema',
        description:
          'Run npx @hypequery/cli generate against your ClickHouse instance. You get a typed schema file in seconds — then build typed queries against it.',
        primaryCta: { href: '/docs/quick-start', label: 'Open quick start' },
        secondaryCta: { href: '/docs/schemas', label: 'Read the schemas guide' },
      }}
    />
  );
}
