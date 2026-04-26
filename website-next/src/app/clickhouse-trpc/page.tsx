import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse tRPC — Typed Analytics Procedures | hypequery',
  description:
    'Integrate ClickHouse analytics into your tRPC API. hypequery query definitions become tRPC procedures — fully typed from ClickHouse schema to React client.',
  robots: {
    index: false,
    follow: true,
  },
  alternates: { canonical: absoluteUrl('/clickhouse-trpc') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-trpc'),
    title: 'ClickHouse tRPC — Typed Analytics Procedures | hypequery',
    description:
      'Integrate ClickHouse analytics into your tRPC API. hypequery query definitions become tRPC procedures — fully typed from ClickHouse schema to React client.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse tRPC — Typed Analytics Procedures | hypequery',
    description:
      'Integrate ClickHouse analytics into your tRPC API. hypequery query definitions become tRPC procedures — fully typed from ClickHouse schema to React client.',
  },
};

const procedureCode = `import { router, protectedProcedure } from '@/server/trpc';
import { z } from 'zod';
import { db } from '@/lib/clickhouse';

export const analyticsRouter = router({
  revenueByDay: protectedProcedure
    .input(
      z.object({
        startDate: z.string(),
        endDate: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // ctx.tenantId comes from your tRPC context (JWT, session, etc.)
      const rows = await db
        .table('orders')
        .select(['order_date', 'sum(total) as revenue'])
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('order_date', 'gte', input.startDate)
        .where('order_date', 'lte', input.endDate)
        .groupBy(['order_date'])
        .orderBy('order_date', 'ASC')
        .execute();

      // rows is typed: { order_date: string; revenue: string }[]
      // UInt64 columns come back as string — exactly what ClickHouse returns
      return rows;
    }),
});`;

const fullStackCode = `// server/routers/analytics.ts
import { router, protectedProcedure } from '@/server/trpc';
import { z } from 'zod';
import { db } from '@/lib/clickhouse';

export const analyticsRouter = router({
  activeUsers: protectedProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90) }))
    .query(async ({ ctx, input }) => {
      const start = new Date(Date.now() - input.windowDays * 86_400_000)
        .toISOString()
        .replace('T', ' ')
        .slice(0, 19);

      return db
        .table('events')
        .select(['toStartOfDay(timestamp) as day', 'uniq(user_id) as active_users'])
        .where('tenant_id', 'eq', ctx.tenantId)
        .where('timestamp', 'gte', start)
        .groupBy(['day'])
        .orderBy('day', 'ASC')
        .execute();
    }),
});

// components/ActiveUsersChart.tsx
import { trpc } from '@/lib/trpc';

export function ActiveUsersChart() {
  const { data, isLoading } = trpc.analytics.activeUsers.useQuery({
    windowDays: 30,
  });

  // data is typed: { day: string; active_users: string }[]
  if (isLoading) return <Spinner />;

  return (
    <LineChart
      data={data ?? []}
      xKey="day"
      yKey="active_users"
    />
  );
}`;

export default function ClickHouseTrpcPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse tRPC"
      title="Use hypequery ClickHouse queries as tRPC procedures"
      description="tRPC gives you end-to-end type safety from server to React client. hypequery gives you end-to-end type safety from ClickHouse schema to TypeScript. Combining them means your analytics procedures are typed all the way from the database column definition to the component that renders the chart."
      primaryCta={{ href: '/docs/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/clickhouse-typescript', label: 'See the TypeScript guide' }}
      stats={[
        { label: 'Integration layer', value: 'tRPC procedure' },
        { label: 'Type source', value: 'ClickHouse schema' },
        { label: 'Best for', value: 'Full-stack TypeScript apps' },
      ]}
      problems={[
        {
          title: "tRPC doesn't query ClickHouse natively — you lose types immediately",
          copy:
            "tRPC procedures delegate to whatever data layer you choose. When that layer is raw @clickhouse/client, the response is untyped. You end up casting to any or manually annotating shapes that should be inferred from the ClickHouse schema itself.",
        },
        {
          title: 'ClickHouse analytics need a bridge into the tRPC router model',
          copy:
            'A tRPC procedure expects validated input and a typed return value. ClickHouse queries produce rows with column names and ClickHouse-native types — DateTime, UInt64, Nullable. Reconciling the two by hand means schema definitions in three places: the database, the query, and the tRPC output type.',
        },
        {
          title: 'Multi-tenant analytics need tenant context from tRPC ctx — wiring it manually is repetitive',
          copy:
            'Every analytics procedure needs to read tenantId from the tRPC context and inject it into the ClickHouse WHERE clause. Without a shared pattern, each procedure implements its own auth extraction and tenant filtering independently.',
        },
      ]}
      solutionSection={{
        eyebrow: 'How it fits together',
        title: 'Call hypequery inside tRPC procedures — types flow through automatically',
        description:
          'hypequery query builder methods return TypeScript types inferred directly from your ClickHouse schema. When you call those methods inside a tRPC procedure, the return type of the procedure is inferred automatically — no manual annotation, no casting.',
        bullets: [
          'Run npx @hypequery/cli generate to produce schema.ts from your live ClickHouse instance',
          'Import db (the typed query builder) and call it inside a tRPC procedure',
          'Pass ctx.tenantId from tRPC context directly into the WHERE clause',
          'tRPC infers the procedure output type from the hypequery return value',
          'useQuery() on the client gets the same inferred type — DateTime columns as string, UInt64 as string, Nullable as T | null',
        ],
        codePanel: {
          eyebrow: 'tRPC procedure',
          title: 'Typed ClickHouse query inside a tRPC router',
          description:
            'Tenant context flows from tRPC ctx to the ClickHouse WHERE clause. The procedure output type is inferred from the query — no manual annotation needed.',
          code: procedureCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Full stack',
        title: 'From ClickHouse schema to React hook — one type chain, no casting',
        description:
          'The hypequery query builder produces column types from your schema. Those types become the tRPC procedure output. tRPC propagates them to the React client. The component that renders the chart knows the exact shape of every row without any manual type annotation in the middle.',
        paragraphs: [
          'This pattern scales to multi-tenant apps cleanly. Each procedure reads tenantId from the tRPC context once — defined in the context factory when you create the tRPC instance — and passes it to the ClickHouse query. No per-procedure auth logic.',
          'If you need HTTP access from outside the tRPC client (mobile apps, third-party consumers), pair this with @hypequery/serve to expose the same query as a REST endpoint alongside the tRPC router.',
        ],
        codePanel: {
          eyebrow: 'Full stack example',
          title: 'tRPC procedure and the React hook that consumes it',
          description:
            'The component does not import any ClickHouse types. Everything is inferred through tRPC from the hypequery query definition.',
          code: fullStackCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse tRPC router',
          copy:
            'Adding ClickHouse queries to a tRPC router is straightforward: call the hypequery query builder inside your procedure and return the result. tRPC infers the output type from whatever the async function returns.',
        },
        {
          title: 'tRPC analytics backend TypeScript',
          copy:
            'A tRPC analytics backend needs validated inputs, typed ClickHouse responses, and tenant context injection. hypequery handles the ClickHouse side — you wire the tRPC context once and every procedure inherits it.',
        },
        {
          title: 'ClickHouse typed procedures',
          copy:
            'ClickHouse column types (DateTime, UInt64, Nullable) map to TypeScript types through hypequery schema generation. The procedure output type is inferred — you never write a manual response interface for a ClickHouse query again.',
        },
        {
          title: 'tRPC ClickHouse query builder',
          copy:
            "Using a query builder inside tRPC procedures keeps analytics logic reusable. The same hypequery query can run inside a tRPC procedure, a server component, or a cron job — it's not bound to the HTTP layer.",
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-typescript',
          title: 'ClickHouse TypeScript',
          description: 'The foundation: schema-generated types and the query builder API.',
        },
        {
          href: '/clickhouse-react',
          title: 'ClickHouse React',
          description: 'Typed React hooks for ClickHouse analytics — the browser-side counterpart to tRPC procedures.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'Expose the same queries as typed REST endpoints alongside your tRPC router.',
        },
        {
          href: '/clickhouse-nextjs',
          title: 'ClickHouse Next.js',
          description: 'Integrate ClickHouse analytics into Next.js App Router with server components and API routes.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your schema, then call the query builder inside a tRPC procedure',
        description:
          'Run npx @hypequery/cli generate to produce typed schema bindings from your ClickHouse instance. After that, the query builder is ready to call from any tRPC procedure — types flow through automatically.',
        primaryCta: { href: '/docs/quick-start', label: 'Open the quick start' },
        secondaryCta: { href: '/clickhouse-typescript', label: 'See the TypeScript guide' },
      }}
    />
  );
}
