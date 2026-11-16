import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import ExamplesBlock from '@/components/examples/ExamplesBlock';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse TypeScript Client for ClickHouse Cloud',
  description:
    'A TypeScript client for ClickHouse and ClickHouse Cloud. Connect over HTTPS, generate schema types from your Cloud service, and build typed queries and APIs.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-typescript'),
  },
  openGraph: {
    images: ogImage('ClickHouse TypeScript Client for ClickHouse Cloud'),
    type: 'website',
    url: absoluteUrl('/clickhouse-typescript'),
    title: 'ClickHouse TypeScript Client for ClickHouse Cloud | hypequery',
    description:
      'Connect to ClickHouse Cloud or self-hosted ClickHouse from TypeScript, with generated schema types, typed queries, and reusable analytics definitions.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse TypeScript Client for ClickHouse Cloud | hypequery',
    description:
      'Use ClickHouse and ClickHouse Cloud with TypeScript through generated schema types, typed queries, and reusable analytics APIs.',
  },
};

const schemaCode = `npx hypequery generate --output analytics/schema.ts`;

const cloudEnvCode = `# From the Connect dialog of your ClickHouse Cloud service
CLICKHOUSE_URL=https://abc123xyz.eu-west-1.aws.clickhouse.cloud:8443
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=your-service-password
CLICKHOUSE_DATABASE=default

# Install the client and CLI in your project
npm install @hypequery/clickhouse
npm install -D @hypequery/cli

# Generates types from the tables in your Cloud service
npx hypequery generate --output analytics/schema.ts`;

const cloudClientCode = `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema.js';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!, // https://<service>.<region>.<cloud>.clickhouse.cloud:8443
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

// Rows are typed from your Cloud schema, not hand-written interfaces
const topPages = await db
  .table('page_views')
  .select(['path'])
  .count('path', 'views')
  .groupBy(['path'])
  .orderBy('views', 'DESC')
  .limit(10)
  .execute();`;

const cloudNotes = [
  {
    title: 'HTTPS on port 8443',
    copy:
      'ClickHouse Cloud serves the HTTP interface over TLS on port 8443. hypequery runs on @clickhouse/client underneath, so the same connection URL from the Cloud console works unchanged.',
  },
  {
    title: 'Types from the service you deploy against',
    copy:
      'Point the CLI at a development or staging Cloud service and commit the generated schema file. Regenerate in CI when tables change, and the build fails where query code no longer matches.',
  },
  {
    title: 'Idle services and cold starts',
    copy:
      'Cloud services can idle when no queries arrive. The first query after a pause can take longer while the service wakes, so set request timeouts with that in mind.',
  },
  {
    title: 'Same code for self-hosted and local',
    copy:
      'Only the URL changes between ClickHouse Cloud, a self-hosted cluster, and a local Docker container. The query code, generated types, and API definitions stay the same.',
  },
];

const queryCode = `const { query, serve } = initServe({
  context: () => ({ db }),
});

const revenueByDay = query({
  input: z.object({
    startDate: z.string(),
    endDate: z.string(),
  }),
  query: async ({ ctx, input }) => {
    return ctx.db
      .table('orders')
      .where('created_at', 'gte', input.startDate)
      .where('created_at', 'lte', input.endDate)
      .groupBy(['day'])
      .sum('total', 'revenue')
      .execute();
  },
});

const api = serve({
  queries: { revenueByDay },
});

api.route('/revenue-by-day', api.queries.revenueByDay, { method: 'POST' });`;

const problems = [
  {
    title: 'ClickHouse types do not map cleanly to JavaScript',
    copy:
      'DateTime values come back as strings, UInt64 values often need to stay strings, and Nullable columns return null. If you hand-write TypeScript interfaces, TypeScript trusts the wrong types.',
  },
  {
    title: 'Raw SQL strings do not scale across a product codebase',
    copy:
      'The same analytics query ends up duplicated in API routes, background jobs, dashboards, and internal tools. Refactors become fragile because the query contract is spread across string literals.',
  },
  {
    title: 'Most teams end up rebuilding the same analytics layer',
    copy:
      'Once a ClickHouse project grows, teams want generated schema types, reusable query definitions, typed APIs, and a clean way to share analytics logic between backend and frontend.',
  },
];

const benefits = [
  'Generate TypeScript schema types from your live ClickHouse database',
  'Build type-safe ClickHouse queries without hand-maintained interfaces',
  'Reuse the same analytics definitions across APIs, jobs, and dashboards',
  'Expose typed HTTP endpoints with request and response schemas',
  'Keep ClickHouse runtime types aligned with your TypeScript codebase',
];

const comparisonLinks = [
  {
    href: '/blog/clickhouse-typescript-type-problem',
    title: 'The ClickHouse TypeScript type problem',
    description: 'A deep dive into the runtime type mismatches that bite TypeScript teams on ClickHouse.',
  },
  {
    href: '/compare/hypequery-vs-clickhouse-client',
    title: 'hypequery vs @clickhouse/client',
    description: 'What you actually gain when you move from raw queries to generated schema types and reusable query definitions.',
  },
  {
    href: '/compare/hypequery-vs-kysely',
    title: 'hypequery vs Kysely',
    description: 'Where Kysely is excellent, where ClickHouse changes the tradeoffs, and when hypequery is the better fit.',
  },
  {
    href: '/compare/hypequery-vs-drizzle',
    title: 'hypequery vs Drizzle',
    description: 'Drizzle ORM has no ClickHouse driver. What to use instead, and where each tool fits.',
  },
  {
    href: '/blog/add-clickhouse-analytics-nodejs-backend#testing-clickhouse-queries',
    title: 'How to test ClickHouse queries in TypeScript',
    description: 'Type checks in CI, SQL assertions, and integration tests against chDB or a ClickHouse container.',
  },
  {
    href: '/blog/clickhouse-final-replacingmergetree-typescript',
    title: 'FINAL vs ReplacingMergeTree Dedup in TypeScript Queries',
    description: 'The ClickHouse FINAL keyword forces ReplacingMergeTree deduplication at query time, at a performance cost. When FINAL is fine, when to use argMax or LIMIT BY instead, and how to write all three in TypeScript.',
  },
  {
    href: '/blog/clickhouse-pagination-typescript',
    title: 'How to Paginate ClickHouse Results in TypeScript',
    description: 'Three pagination patterns for ClickHouse in TypeScript — offset/limit, cursor-based, and keyset. Code examples with hypequery and the raw @clickhouse/client.',
  },
];

const ecosystemLinks = [
  {
    href: '/clickhouse',
    title: 'ClickHouse with TypeScript and Python',
    description: 'The hub for every ClickHouse client, framework, SQL guide and function page on this site.',
  },
  {
    href: '/clickhouse-nextjs',
    title: 'ClickHouse Next.js',
    description: 'How to reuse typed analytics queries across App Router handlers and server components.',
  },
  {
    href: '/clickhouse-react',
    title: 'ClickHouse React',
    description: 'How to turn a typed analytics API into React hooks for interactive dashboards.',
  },
  {
    href: '/clickhouse-analytics',
    title: 'ClickHouse Analytics',
    description: 'Why schema-driven query definitions become an analytics layer, not just a query builder.',
  },
  {
    href: '/clickhouse-multi-tenant-analytics',
    title: 'ClickHouse Multi-Tenant Analytics',
    description: 'How to apply tenant isolation when ClickHouse powers customer-facing analytics features.',
  },
];

export default function ClickHouseTypeScriptPage() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-bg pt-[62px] text-text">
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <p className={marketing.eyebrow}>
              ClickHouse TypeScript client
            </p>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              A TypeScript client for ClickHouse and ClickHouse Cloud
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              The official TypeScript client for ClickHouse Cloud is <code>@clickhouse/client</code> for Node.js, or <code>@clickhouse/client-web</code> for browsers and Cloudflare Workers, connecting over HTTPS on port 8443. hypequery builds on it and connects to ClickHouse Cloud, self-hosted ClickHouse, or a local container with the same code. The annoying part of using ClickHouse from TypeScript is not writing SQL. It is keeping runtime types, query code, and API surfaces aligned as the codebase grows. hypequery gives you generated schema types and a reusable query layer so that work does not keep getting rebuilt by hand.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                Start with hypequery
              </Link>
              <Link
                href="/clickhouse-schema"
                data-umami-event="cta_click"
                data-umami-event-target="clickhouse_schema"
                data-umami-event-location="hero_secondary"
                className={marketing.secondaryButton}
              >
                Generate schema types
              </Link>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Core benefit</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Generated schema types</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Execution model</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Local or HTTP</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Best fit</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Analytics-heavy TypeScript apps</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-6 lg:grid-cols-3">
            {problems.map((problem) => (
              <div key={problem.title} className={marketing.card}>
                <h2 className={marketing.cardTitle}>{problem.title}</h2>
                <p className="mt-4 text-sm leading-6 text-text-muted">{problem.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
            <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
              <div>
                <p className={marketing.eyebrow}>
                  How hypequery helps
                </p>
              <h2 className={`mt-3 ${marketing.sectionTitle}`}>
                A ClickHouse TypeScript workflow built for reusable analytics
              </h2>
              <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
                Instead of hand-writing TypeScript interfaces and copying SQL into route handlers, jobs, and dashboards, you generate schema types from ClickHouse and define the query once. That definition can run locally or be served over HTTP without drifting from the source query.
              </p>
                <ul className="mt-8 space-y-3 text-sm text-text">
                  {benefits.map((benefit) => (
                    <li key={benefit} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">Step 1</p>
                <h3 className={`mt-3 ${marketing.cardTitle}`}>
                  Generate schema types from ClickHouse
                </h3>
                <CodeWindow code={schemaCode} filename="generate-schema.sh" language="bash" className="mt-4" />
                <p className="mt-4 text-sm leading-6 text-text-muted">
                  This is where the ClickHouse TypeScript workflow becomes reliable. Runtime types like
                  `DateTime`, `UInt64`, `Nullable`, and `Decimal` get mapped correctly instead of being guessed.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
                <p className={marketing.eyebrow}>
                Step 2
              </p>
              <h2 className={`mt-3 ${marketing.sectionTitle}`}>
                Define typed ClickHouse queries once
              </h2>
              <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">
                hypequery lets you model analytics queries in TypeScript and reuse them across product surfaces.
                That means the same query definition can power a dashboard, an API route, a job, or an internal tool
                without duplicating logic.
              </p>
              <div className="mt-8 space-y-4 text-sm leading-6 text-text-muted">
                <p>
                  This is the difference between “ClickHouse client in TypeScript” and a real ClickHouse analytics
                  backend in TypeScript. You are not just running queries. You are defining typed contracts that can
                  be reused safely.
                </p>
                <p>
                  If you want the shortest path to a working setup, skip the comparison content and <Link href="/docs/quick-start" className="text-accent hover:opacity-70">start with hypequery now</Link>. One real query against your own schema will tell you more than another hour of reading.
                </p>
                <p>
                  If your team is comparing options, read <Link href="/compare/hypequery-vs-clickhouse-client" className="text-accent hover:opacity-70">hypequery vs @clickhouse/client</Link>, <Link href="/compare/hypequery-vs-kysely" className="text-accent hover:opacity-70">hypequery vs Kysely</Link>, and <Link href="/compare/hypequery-vs-drizzle" className="text-accent hover:opacity-70">hypequery vs Drizzle</Link> after this page.
                </p>
              </div>
            </div>
            <div className={marketing.card}>
              <CodeWindow code={queryCode} filename="analytics-api.ts" className="mt-0" />
            </div>
          </div>
        </section>

        <section id="clickhouse-cloud" className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
            <p className={marketing.eyebrow}>ClickHouse Cloud</p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>
              Use ClickHouse Cloud from TypeScript
            </h2>
            <p className="mt-4 max-w-[760px] text-sm leading-6 text-text-muted sm:text-base">
              The official <code className="font-mono text-text">@clickhouse/client</code> connects to ClickHouse Cloud and leaves the result types to you. hypequery uses that same client as its transport and adds the parts a ClickHouse Cloud TypeScript app needs next: types generated from the tables in your Cloud service, a typed query builder, and query definitions you can serve as HTTP endpoints. Copy the HTTPS URL and password from the <strong className="font-medium text-text">Connect</strong> dialog of your service, then:
            </p>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">1. Point the CLI at your Cloud service</p>
                <CodeWindow code={cloudEnvCode} filename=".env + terminal" language="bash" className="mt-4" />
              </div>
              <div className={marketing.card}>
                <p className="font-mono text-xs text-text-dim">2. Query it with generated types</p>
                <CodeWindow code={cloudClientCode} filename="analytics/db.ts" className="mt-4" />
              </div>
            </div>
            <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {cloudNotes.map((note) => (
                <div key={note.title} className={marketing.card}>
                  <h3 className={marketing.cardTitle}>{note.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-text-muted">{note.copy}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-sm leading-6 text-text-muted">
              Deciding between ClickHouse Cloud and a hosted API platform? Read <Link href="/compare/clickhouse-cloud-vs-tinybird" className="text-accent hover:opacity-70">ClickHouse Cloud vs Tinybird</Link>. Weighing the raw client? Read <Link href="/compare/hypequery-vs-clickhouse-client" className="text-accent hover:opacity-70">hypequery vs @clickhouse/client</Link>.
            </p>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div>
            <p className="font-mono text-xs text-text-dim">Why teams search for this</p>
            <h2 className={`mt-3 ${marketing.sectionTitle}`}>
              Common ClickHouse TypeScript problems this page should solve
            </h2>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  ClickHouse query builder for TypeScript
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  If you want a ClickHouse query builder with real TypeScript support, the key question is not just syntax.
                  It is whether the builder understands ClickHouse runtime types and can be reused across your app.
                </p>
              </div>
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  ClickHouse types in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  DateTime, UInt64, Decimal, and Nullable columns are where most silent bugs start. If that is your main
                  pain point, read <Link href="/blog/clickhouse-typescript-type-problem" className="text-accent hover:opacity-70">the type problem guide</Link>.
                </p>
              </div>
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  Reusable analytics APIs in TypeScript
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  Teams often start with raw queries and then realize they need typed APIs, internal analytics services,
                  or OpenAPI docs on top. hypequery is optimized for that step-up in complexity.
                </p>
              </div>
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  Alternatives to hand-written query types
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  Hand-maintained interfaces drift. Generated schema types plus typed query definitions remove that drift
                  from the system instead of relying on discipline alone.
                </p>
              </div>
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  How do I use ClickHouse with TypeScript?
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  Start by introspecting the live schema. Generate TypeScript types from that schema. Build queries against those types. Then decide where the query needs to run: inline, behind an endpoint, or in a dashboard. That is the workflow hypequery makes easier.
                </p>
              </div>
              <div className={marketing.card}>
                <h3 className={marketing.cardTitle}>
                  Does hypequery work with ClickHouse Cloud?
                </h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">
                  Yes. Use the HTTPS URL on port 8443 from your service&apos;s Connect dialog as the host, with the service username and password. Schema generation, the query builder, and served endpoints all work the same as on self-hosted ClickHouse. See <a href="#clickhouse-cloud" className="text-accent hover:opacity-70">the ClickHouse Cloud setup above</a>.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <p className={marketing.eyebrow}>Further reading</p>
          <h2 className={`mt-3 ${marketing.sectionTitle}`}>
            Compare approaches and go deeper
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-3">
            {comparisonLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl border border-border bg-bg-card p-6 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
              >
                <h3 className={marketing.cardTitle}>{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">{item.description}</p>
                <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-accent group-hover:opacity-70">
                  Open article
                </p>
              </Link>
            ))}
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {ecosystemLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl border border-border bg-bg-card p-5 transition hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
              >
                <h3 className="text-lg font-medium tracking-tight text-text">{item.title}</h3>
                <p className="mt-3 text-sm leading-6 text-text-muted">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <ExamplesBlock leadPage="/clickhouse-typescript" />

        <section className={`${marketing.container} pb-20`}>
          <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className={marketing.eyebrow}>
                Next step
              </p>
              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
                Start with hypequery on one real ClickHouse query
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
                Generate schema types, define your first typed query, and prove the workflow on your actual ClickHouse schema before expanding further.
              </p>
            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="next_step_primary"
                className={marketing.primaryButton}
              >
                Start with hypequery
              </Link>
              <Link
                href="/clickhouse-schema"
                data-umami-event="cta_click"
                data-umami-event-target="clickhouse_schema"
                data-umami-event-location="next_step_secondary"
                className={marketing.secondaryButton}
              >
                Generate schema types
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
