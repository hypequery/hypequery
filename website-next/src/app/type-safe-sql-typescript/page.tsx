import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Type-Safe SQL in TypeScript: A Practical Guide',
  description:
    'What type-safe SQL actually means in TypeScript, how Prisma, Drizzle, Kysely, and SQL codegen tools compare, and how to get the same guarantees on ClickHouse.',
  alternates: { canonical: absoluteUrl('/type-safe-sql-typescript') },
  openGraph: {
    images: ogImage('Type-Safe SQL in TypeScript'),
    type: 'website',
    url: absoluteUrl('/type-safe-sql-typescript'),
    title: 'Type-Safe SQL in TypeScript: A Practical Guide | hypequery',
    description:
      'Compile-time column checking, typed results, and honest runtime mappings. How Prisma, Drizzle, Kysely, and codegen tools compare, and what to use for ClickHouse.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Type-Safe SQL in TypeScript: A Practical Guide | hypequery',
    description:
      'Compile-time column checking, typed results, and honest runtime mappings. How Prisma, Drizzle, Kysely, and codegen tools compare, and what to use for ClickHouse.',
  },
};

const handWrittenCode = `// Raw client + hand-written types:
// the compiler believes whatever you tell it
import { createClient } from '@clickhouse/client';

interface OrderRow {
  id: number;        // actually a UUID string
  total: number;     // actually Decimal(18,4) — arrives as a string
  created_at: Date;  // actually DateTime — arrives as a string
}

const clickhouse = createClient({ url: process.env.CLICKHOUSE_URL });
const result = await clickhouse.query({
  query: 'SELECT id, total, created_at FROM orders LIMIT 100',
});
const rows = await result.json<OrderRow[]>();

// Compiles clean. Then rows[0].total.toFixed(2) throws at runtime,
// and renaming a column in the database breaks nothing —
// until the query runs in production.`;

const hypequeryCode = `// 1. Generate types from the live ClickHouse schema:
//    npx @hypequery/cli generate --output ./src/generated/schema.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated/schema.js';

const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// 2. Tables, columns, operators, and results checked as you type
const revenueByRegion = await db
  .table('orders')
  .select(['region'])
  .sum('total', 'revenue')
  .count('id', 'order_count')
  .where('status', 'eq', 'completed')
  .groupBy('region')
  .limit(20)
  .execute();

// revenueByRegion: { region: string; revenue: string; order_count: string }[]
// revenue and order_count are strings on purpose: Decimal and UInt64
// can exceed Number.MAX_SAFE_INTEGER, so the types match what arrives.`;

export default function TypeSafeSqlTypescriptPage() {
  return (
    <ClickhousePillarPage
      eyebrow="Type-safe SQL in TypeScript"
      title="Type-safe SQL in TypeScript: a practical guide"
      description="Type-safe SQL means three concrete things: the compiler rejects table and column names that do not exist, query results carry real types instead of any, and those types tell the truth about what the database driver actually returns. Prisma, Drizzle, Kysely, and SQL codegen tools all deliver this for Postgres and MySQL. None of them cover ClickHouse. This guide explains how each approach works, where each one shines, and what to use when your analytics database is ClickHouse."
      primaryCta={{ href: '/docs/quick-start', label: 'Start with hypequery' }}
      secondaryCta={{ href: '/clickhouse-typescript', label: 'ClickHouse + TypeScript guide' }}
      problems={[
        {
          title: 'Compile-time table and column checking',
          copy:
            'The first guarantee: referencing a table or column that does not exist should be a red squiggle, not a runtime exception. This requires the tool to know your schema — from a schema file, from table definitions in code, or from introspecting the database. Raw SQL strings give you none of this: rename a column and every query that mentions it still compiles.',
        },
        {
          title: 'Typed results, not any',
          copy:
            'The second guarantee: a query returns { region: string; revenue: string }[], not any[] or a hand-cast interface. Inferred result types flow into API handlers, chart components, and tests, so a change to the query shape surfaces everywhere it matters. Hand-written interfaces provide the same illusion right up until they drift from the actual query.',
        },
        {
          title: 'Honest runtime type mappings',
          copy:
            'The third guarantee is the one teams miss: types must match what the driver actually returns. ClickHouse returns UInt64 and Decimal as strings over JSON because they can exceed Number.MAX_SAFE_INTEGER, DateTime arrives as a string, and Nullable(T) means T | null. A type that says number when the wire says string is worse than no type at all — it is a confident lie.',
        },
      ]}
      solutionSection={{
        eyebrow: 'The landscape',
        title: 'Four ways TypeScript teams get type-safe SQL',
        description:
          'The ecosystem has converged on four approaches, distinguished by where the types come from. All four are good tools on the databases they target — the right pick depends on how much SQL you want to write and where you want your schema to live.',
        paragraphs: [
          'Prisma is schema-first: you describe your data model in a Prisma schema file, and it generates both migrations and a typed client. It shines for transactional CRUD — relations, nested writes, and a schema that doubles as documentation. The tradeoff is distance from SQL: complex aggregations push you toward its raw query escape hatch.',
          'Drizzle is code-first: tables are TypeScript definitions, and queries look like SQL with autocomplete. It is lightweight, serverless-friendly, and keeps you close to the queries you are actually running. Kysely goes further in the same direction — a pure query builder with no schema DSL at all, typed against a Database interface you supply or generate with kysely-codegen.',
          'pgtyped and sqlc invert the whole model: you write real SQL files, and the tool generates TypeScript types for each query by checking it against the database. If your team thinks in SQL first, this is the least abstraction with the strongest guarantees. The catch is coverage — pgtyped targets Postgres, and sqlc targets Postgres, MySQL, and SQLite.',
        ],
        bullets: [
          'Prisma — schema-first ORM: types from a schema file, best for relational CRUD',
          'Drizzle — code-first schema: tables defined in TypeScript, SQL-shaped queries',
          'Kysely — pure query builder: compile-time SQL against a supplied Database interface',
          'pgtyped / sqlc — codegen from SQL: write real queries, generate types per query',
        ],
        codePanel: {
          eyebrow: 'The baseline',
          title: 'What every approach is fixing',
          description:
            'Without one of these tools, type safety means hand-writing an interface and casting. The compiler cannot check the SQL string against the database, and the interface silently encodes guesses about runtime types — guesses that are frequently wrong for analytics databases.',
          code: handWrittenCode,
        },
      }}
      implementationSection={{
        eyebrow: 'The ClickHouse gap',
        title: 'None of the four cover ClickHouse',
        description:
          'Prisma has no ClickHouse connector (tracked in long-open GitHub issues #16174 and #23292). Drizzle has no ClickHouse driver — the Drizzle team ships Waddler for ClickHouse, but it is a SQL template-tag library, not a typed query builder. Kysely needs a hand-built dialect plus hand-maintained type mappings. pgtyped and sqlc have no ClickHouse target. TypeORM is furthest away of all: its entity model assumes foreign keys and transactions that a columnar, append-oriented database does not offer.',
        paragraphs: [
          'The gap is structural, not an oversight. These tools model row-level transactional entities, and ClickHouse is columnar and aggregation-first, with types (UInt64, LowCardinality, AggregateFunction, arrays) and clauses (PREWHERE, LIMIT BY, FINAL) that generic SQL abstractions do not represent.',
          'hypequery closes the gap the same way kysely-codegen and pgtyped do — types come from the database, not your imagination — but built for ClickHouse specifically. One command introspects the live schema and generates types with the honest runtime mappings: UInt64 → string, DateTime → string, Nullable(T) → T | null. The query builder is then typed end to end, with ClickHouse-native features like PREWHERE, LIMIT BY, FINAL, and CTEs as first-class methods, and selectExpr/rawAs escape hatches when you need raw SQL expressions.',
          'A common production setup keeps both worlds: Prisma or Drizzle on Postgres for the transactional app, hypequery on ClickHouse for analytics. The type-safety guarantees are the same shape on each side — each tool just has to be honest about the database underneath it.',
        ],
        codePanel: {
          eyebrow: 'ClickHouse answer',
          title: 'Types generated from the live schema',
          description:
            'The same three guarantees — checked columns, inferred results, honest runtime mappings — applied to ClickHouse. Re-run generate after a schema change and the compiler flags every query the change breaks.',
          code: hypequeryCode,
        },
      }}
      comparisonTable={{
        eyebrow: 'At a glance',
        title: 'Generic type-safe SQL tools vs a ClickHouse-native one',
        description:
          'This table is only about ClickHouse coverage. On Postgres or MySQL, Prisma, Drizzle, Kysely, and pgtyped/sqlc are all strong choices, and comparing them there is a different conversation.',
        competitorLabel: 'Prisma / Drizzle / Kysely / SQL codegen',
        rows: [
          {
            label: 'Where types come from',
            competitor:
              'A Prisma schema file, TypeScript table definitions, a hand-supplied Database interface, or annotated SQL files checked against Postgres/MySQL.',
            hypequery:
              'Introspected from your live ClickHouse schema with one generate command — no hand-written interfaces to drift.',
          },
          {
            label: 'ClickHouse support',
            competitor:
              'None native. Prisma and Drizzle have no ClickHouse driver (Waddler is a template-tag layer, not a typed builder); Kysely needs a custom dialect; pgtyped and sqlc have no ClickHouse target.',
            hypequery:
              'ClickHouse only. Built on the official @clickhouse/client and designed around ClickHouse semantics.',
          },
          {
            label: 'Runtime type honesty',
            competitor:
              'Tuned for Postgres/MySQL drivers, where numbers are numbers and dates are Dates. ClickHouse wire formats break those assumptions.',
            hypequery:
              'Generated types encode ClickHouse reality: UInt64 → string, DateTime → string, Nullable(T) → T | null.',
          },
          {
            label: 'ClickHouse SQL surface',
            competitor:
              'Generic SQL only — no PREWHERE, LIMIT BY, FINAL, array joins, or query settings.',
            hypequery:
              'PREWHERE, LIMIT BY, FINAL, array joins, CTEs, withTotals, and query settings are typed builder methods; selectExpr covers window functions and raw expressions.',
          },
        ],
        footnote:
          'Even-handed by design: if your workload is transactional Postgres, pick Prisma, Drizzle, Kysely, or pgtyped/sqlc and be happy. This page is about the database they do not cover.',
      }}
      searchIntentCards={[
        {
          title: 'Which tool should I pick for Postgres or MySQL?',
          copy:
            'Any of the four, based on taste: Prisma if you want a schema-first ORM with migrations, Drizzle if you want tables defined in TypeScript and SQL-shaped queries, Kysely if you want a pure query builder with no ORM layer, pgtyped or sqlc if you want to write real SQL and generate types from it. The type-safety guarantees are comparable; the ergonomics differ.',
        },
        {
          title: 'Does TypeScript actually catch SQL errors at compile time?',
          copy:
            'It catches exactly what the types encode: unknown tables and columns, wrong filter value types, and mismatched result shapes. It does not catch logic errors, missing GROUP BY intent, or slow queries. Compile-time safety narrows the failure space — it does not replace testing against a real database.',
        },
        {
          title: 'Why do my ClickHouse numbers come back as strings?',
          copy:
            'UInt64, Int64, and Decimal values can exceed JavaScript’s Number.MAX_SAFE_INTEGER, so ClickHouse serialises them as strings over JSON rather than silently corrupting them. A type-safe ClickHouse layer must surface this as string in the types. Tools that declare number for these columns are wrong in the way that costs you money in a revenue query.',
        },
        {
          title: 'What about raw SQL escape hatches?',
          copy:
            'Every serious tool has one, and needing it is not failure. In hypequery, window functions and arbitrary expressions go through selectExpr and rawAs inside a typed select, so one raw expression does not force the whole query — or its result type — back to any.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse and TypeScript',
          description:
            'The full picture of using ClickHouse from TypeScript: schema types, query building, and typed delivery to APIs and React.',
        },
        {
          href: '/clickhouse-query-builder',
          title: 'ClickHouse Query Builder',
          description:
            'The composable builder in depth — filters, aggregations, joins, CTEs, LIMIT BY, FINAL, and the escape hatches.',
        },
        {
          href: '/compare/hypequery-vs-kysely',
          title: 'hypequery vs Kysely',
          description:
            'A direct comparison for teams who like the pure query-builder model and want it on ClickHouse.',
        },
        {
          href: '/clickhouse-orm',
          title: 'ClickHouse ORM',
          description:
            'Why there is no Prisma for ClickHouse, and what the ORM-like workflow looks like on a columnar database.',
        },
        {
          href: '/prisma-clickhouse',
          title: 'Prisma and ClickHouse',
          description:
            'The state of Prisma + ClickHouse, the MySQL-port workaround, and the OLTP-plus-analytics pattern that actually works.',
        },
        {
          href: '/drizzle-clickhouse',
          title: 'Drizzle and ClickHouse',
          description:
            'What Drizzle offers on ClickHouse today, where Waddler fits, and when to reach for a typed builder instead.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-query-builder', label: 'ClickHouse Query Builder' },
        { href: '/clickhouse-orm', label: 'ClickHouse ORM' },
        { href: '/clickhouse-schema', label: 'ClickHouse Schema' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Get type-safe SQL on ClickHouse in one command',
        description:
          'Run schema generation against your ClickHouse instance and write one real query with checked columns and honest result types. That proves more than any comparison table.',
        primaryCta: { href: '/docs/quick-start', label: 'Start with hypequery' },
        secondaryCta: { href: '/clickhouse-query-builder', label: 'Explore the query builder' },
      }}
    />
  );
}
