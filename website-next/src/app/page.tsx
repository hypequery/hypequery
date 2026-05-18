'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { trackUmamiEvent } from '@/lib/umami';

/* ════════════════════════════════════════════════════════════
   Hero — display headline + subhead + CTAs + tabbed code card
   ════════════════════════════════════════════════════════════ */
const HERO_SNIPPETS = {
  query: `import { createQueryBuilder } from '@hypequery/clickhouse';

const db = createQueryBuilder({
  host: process.env.CLICKHOUSE_HOST,
});

const latestUsers = await db
  .table('users')
  .select(['id', 'email', 'created_at'])
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();
//  ↑ Full autocomplete from your schema`,

  dataset: `import { dataset, field } from '@hypequery/clickhouse';

// NEW — model a table once, reuse everywhere
export const Users = dataset('users', {
  source: 'users',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  fields: {
    id:     field.string(),
    email:  field.string(),
    status: field.enum(['active', 'churned']),
    plan:   field.enum(['free', 'pro', 'enterprise']),
  },
});

// Queries built on a dataset inherit tenant + time keys
const latest = await Users.query()
  .where('status', 'eq', 'active')
  .limit(10)
  .execute();`,

  serve: `import { initServe } from '@hypequery/serve';
import { Users } from './datasets';
import { z } from 'zod';

const activeUsers = query({
  description: 'Most recent active users',
  dataset: Users,
  input: z.object({ limit: z.number().default(10) }),
  query: ({ ctx, input }) => Users.query()
    .where('status', 'eq', 'active')
    .orderBy('created_at', 'DESC')
    .limit(input.limit)
    .execute(),
});

serve({ activeUsers });
//  ↑ Typed HTTP route + React hook from the same definition`,
};

const HERO_TABS = [
  { id: 'query', label: 'query-builder.ts' },
  { id: 'dataset', label: 'datasets.ts' },
  { id: 'serve', label: 'serve-runtime.ts' },
];

function Hero() {
  const [tab, setTab] = useState('dataset');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npx hypequery init');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[140px] pb-16 flex flex-col items-center text-center">
      <span className="inline-flex items-center gap-2 px-3 py-1 mb-7 border border-border-strong rounded-[100px] bg-bg-card font-mono text-[11px] font-medium text-text-muted tracking-[0.04em]">
        <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">New</span>
        <span>Datasets — define a ClickHouse table once, reuse it everywhere</span>
      </span>

      <h1 className="text-display text-text max-w-[920px] text-balance">
        Ship type-safe <em className="not-italic text-accent">ClickHouse queries.</em>
      </h1>

      <p className="mt-[22px] text-body-lg text-text-muted max-w-[560px] text-pretty">
        Define your ClickHouse tables once in TypeScript. <strong className="text-text font-semibold">Query them anywhere, serve them as APIs, and govern them across every consumer</strong> — without leaving your codebase.
      </p>

      <div className="flex gap-2.5 mt-7 flex-wrap justify-center">
        <Link
          href="/docs/quick-start"
          onClick={() => trackUmamiEvent('cta_click', { target: 'docs_quick_start', location: 'hero', page: '/' })}
          className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
        >
          Get started in 30s →
        </Link>
        <a
          href="https://github.com/hypequery/hypequery"
          target="_blank"
          rel="noreferrer"
          onClick={() => trackUmamiEvent('cta_click', { target: 'github_star', location: 'hero', page: '/' })}
          className="bg-transparent text-text px-5 py-3 text-[13.5px] font-semibold rounded border border-border-strong transition hover:border-text hover:bg-bg-alt"
        >
          Star on GitHub
        </a>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <a
          href="https://www.npmjs.com/package/@hypequery/clickhouse"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center rounded-[100px]  p-1 transition hover:border-border-strong hover:-translate-y-px"
        >
          <img
            src="https://img.shields.io/npm/dm/%40hypequery%2Fclickhouse?style=flat-square&label=npm%20downloads&labelColor=111827&color=3a3f8c"
            alt="npm downloads for @hypequery/clickhouse"
            className="h-6 rounded-[100px]"
          />
        </a>
      </div>

      <button
        onClick={handleCopy}
        className="mt-8 group relative inline-flex items-center gap-2.5 px-4 py-2.5 bg-bg-card border border-border-strong rounded-lg font-mono text-[14px] text-text hover:border-text transition hover:-translate-y-px"
      >
        <span className="text-text-muted select-none">$</span>
        <span className="font-medium">npx hypequery init</span>
        <svg
          className="w-4 h-4 text-text-dim group-hover:text-text transition"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          {copied ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          )}
        </svg>
        {copied && (
          <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-text text-bg text-xs font-sans font-medium rounded whitespace-nowrap">
            Copied!
          </span>
        )}
      </button>

      {/* tabbed hero code card */}
      <div className="mt-14 w-full max-w-[880px] relative">
        <div className="absolute -inset-x-16 -inset-y-10 bg-[radial-gradient(ellipse_at_center,var(--accent-soft)_0%,transparent_65%)] blur-3xl pointer-events-none" />
        <div className="relative overflow-hidden rounded-lg border border-border-strong bg-bg-alt shadow-card dark:bg-bg-code">
          <div className="flex items-center gap-1.5 border-b border-border bg-bg-card/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
            <div className="flex ml-3.5">
              {HERO_TABS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`border-b-2 px-3.5 py-1 font-mono text-[11.5px] transition ${tab === t.id ? 'border-accent text-text dark:text-white/95' : 'border-transparent text-text-dim hover:text-text dark:text-white/40 dark:hover:text-white/70'
                    }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-1.5 font-mono text-micro text-text-dim dark:text-white/40">
              <span>{HERO_TABS.find(t => t.id === tab)?.status}</span>
            </div>
          </div>
          <div className="p-4 text-left min-h-[300px] bg-bg-card/60">
            <CodeHighlight
              code={HERO_SNIPPETS[tab as keyof typeof HERO_SNIPPETS]}
              language="typescript"
              className="[&_code]:text-[13.5px] [&_code]:leading-[1.85]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Why — comparison section (old way vs hypequery way)
   ════════════════════════════════════════════════════════════ */
const OLD_WAY_CODE = `const result = await client.query({
  query: \`
    SELECT name, email, created_at
    FROM users
    WHERE created_at >= '2024-01-01'
    AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 10
  \`
});

// No type safety
// Typos caught at runtime
// SQL gets duplicated
// Hard to refactor safely`;

const HYPEQUERY_WAY_CODE = `const result = await db
  .table('users')
  .select(['name', 'email', 'created_at'])
  .where('created_at', 'gte', '2024-01-01')
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();

// Full type safety
// Compile-time checks
// Shared query logic
// Refactor with confidence`;

function Why() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
      <div className="mb-12 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Why teams move beyond raw SQL</p>
        <h2 className="text-h2 text-text max-w-[780px] mx-auto text-balance">
          Type-safe, reusable, consistent
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[640px] mx-auto text-pretty">
          Keep ClickHouse queries type-safe, reusable, and consistent across dashboards, APIs, jobs, and internal tools.
        </p>
      </div>

      <div className="grid-responsive-2">
        {/* Old Way */}
        <article className="bg-bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="p-7 pb-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-bg-alt text-text-dim shrink-0">
                ✗
              </div>
              <div>
                <h3 className="text-h4 text-text">The old way</h3>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-body-sm text-text-muted">
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>YAML. SQL strings.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>Query logic scattered across dashboards, scripts, and services.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>String-concatenated SQL that drifts as schemas evolve.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>Metrics definitions duplicated and re-implemented per team.</span>
              </p>
            </div>
          </div>
          <div className="min-h-[320px] p-4">
            <div className="bg-bg-alt h-full rounded-lg border border-border px-5 py-4">
              <div className="mb-2 font-mono text-[10.5px] text-text-muted">raw-sql.ts</div>
              <CodeHighlight
                code={OLD_WAY_CODE}
                language="typescript"
                className="[&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
              />
            </div>
          </div>
        </article>

        {/* hypequery Way */}
        <article className="bg-bg-card border border-border-strong rounded-lg overflow-hidden flex flex-col relative ring-1 ring-accent/20">
          <div className="absolute -top-px left-1/2 -translate-x-1/2 px-3 py-1 bg-accent text-bg font-mono text-[10px] font-bold tracking-[0.1em] uppercase rounded-b-sm">
            Recommended
          </div>
          <div className="p-7 pb-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-accent-soft text-accent shrink-0">
                ✓
              </div>
              <div>
                <h3 className="text-h4 text-text">The hypequery way</h3>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-body-sm text-text-muted">
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span><strong className="text-text font-semibold">Everything is code.</strong></span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Type-safe metrics defined once in TypeScript.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Reusable definitions power APIs, jobs, dashboards, and agents.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Auth, multi-tenancy, and caching stay consistent everywhere.</span>
              </p>
            </div>
          </div>
          <div className="min-h-[320px] p-4">
            <div className="bg-bg-alt h-full rounded-lg border border-border px-5 py-4 ring-1 ring-accent/10">
              <div className="mb-2 font-mono text-[10.5px] text-accent">type-safe-query.ts</div>
              <CodeHighlight
                code={HYPEQUERY_WAY_CODE}
                language="typescript"
                className="[&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
              />
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Capabilities — paired Query / Dataset cards
   ════════════════════════════════════════════════════════════ */
const QUERY_CODE = `// Ad-hoc — full autocomplete from your schema
const latestUsers = await db
  .table('users')
  .select(['id', 'email', 'created_at'])
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();`;

const DATASET_CODE = `// NEW — model the table once, reuse it everywhere
export const Users = dataset('users', {
  source: 'users',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  fields: {
    id:     field.string(),
    email:  field.string(),
    status: field.enum(['active', 'churned']),
  },
});`;

function CapabilityCard({ icon, label, isNew, title, desc, code, docsLink, docsLabel }: {
  icon: string;
  label: string;
  isNew?: boolean;
  title: string;
  desc: string;
  code: string;
  docsLink: string;
  docsLabel: string;
}) {
  return (
    <article className="bg-bg-card border border-border rounded-lg overflow-hidden flex flex-col transition hover:-translate-y-0.5 hover:shadow-card hover:border-border-strong">
      <div className="p-7 pb-4 flex items-start gap-3.5 border-b border-border">
        <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-accent-soft text-accent shrink-0">
          {icon}
        </div>
        <div>
          <div className="font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase text-text-muted flex items-center gap-2">
            {label}
            {isNew && (
              <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">
                New
              </span>
            )}
          </div>
          <h3 className="mt-1.5 text-h3 text-text">{title}</h3>
          <p className="mt-2 text-body-sm text-text-muted max-w-[420px]">{desc}</p>
        </div>
      </div>
      <div className="min-h-[260px] p-4 flex flex-col">
        <div className="bg-bg-alt flex-1 rounded-lg border border-border px-5 py-4">
          <CodeHighlight
            code={code}
            language="typescript"
            className="[&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
          />
        </div>
        <Link
          href={docsLink}
          className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:text-text transition self-start"
        >
          {docsLabel} →
        </Link>
      </div>
    </article>
  );
}

function Capabilities() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
      <div className="mb-12">
        <p className="font-mono text-eyebrow text-accent mb-3.5">What you get</p>
        <h2 className="text-h2 text-text max-w-[700px] text-balance">
          Type-safe queries. Semantic layer. Instant HTTP APIs. Opt-in across the stack.
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[560px] text-pretty">
          hypequery does not force you into a framework on day one. Improve your developer experience and reach for more when you need it.
        </p>
      </div>

      <div className="grid-responsive-2 mt-12">
        <CapabilityCard
          icon="Q"
          label="Query builder"
          title="Generate types from your schema and query with full type safety"
          desc="Every table, column, and filter is autocompleted from your schema. Typos are caught at compile time, not in production. Refactor a column name and every query that references it breaks loudly and immediately."
          code={QUERY_CODE}
          docsLink="/docs/query-building/basics"
          docsLabel="Read about the query builder"
        />
        <CapabilityCard
          icon="D"
          label="Datasets"
          isNew
          title="Your semantic layer in code."
          desc="A dataset is a named definition of a table, measures and dimensions all declared in one place. The semantic layer for TypeScript developers."
          code={DATASET_CODE}
          docsLink="/docs/datasets"
          docsLabel="Read about datasets"
        />
      </div>

      <div className="mt-3.5">
        <CapabilityCard
          icon="S"
          label="Serve"
          title="Serve any query or dataset as a typed API."
          desc="Pass a query or dataset into serve(). You get a typed REST route, an OpenAPI spec, and a React hook from the same definition you already wrote."
          code={SERVE_CODE}
          docsLink="/docs/serve"
          docsLabel="Read about serve"
        />
      </div>
    </section>
  );
}


/* ════════════════════════════════════════════════════════════
   Datasets Deep Dive — tell the story of key features
   ════════════════════════════════════════════════════════════ */
const DATASET_DEFINITION = `import { dataset, field } from '@hypequery/clickhouse';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  fields: {
    id:     field.string(),
    amount: field.number(),
    status: field.enum(['paid', 'refunded']),
    userId: field.string(),
  },
});`;

const DATASET_API_USE = `// In your API route
const revenue = await Orders.query()
  .where('status', 'eq', 'paid')
  .sum('amount')
  .execute();
// Auto-filtered by tenant_id`;

const DATASET_JOB_USE = `// In your background job
const dailyRevenue = await Orders.query()
  .where('created_at', 'gte', startOfDay)
  .sum('amount')
  .execute();
// Same tenant filter, same definition`;

const DATASET_DASHBOARD_USE = `// In your React dashboard
const { data } = useQuery({
  query: Orders.query()
    .where('status', 'eq', 'paid')
    .groupBy('userId')
    .sum('amount')
});
// Same filter, same types, zero duplication`;

function DatasetsDeepDive() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-[96px] bg-bg-alt/30">
      <div className="mb-16 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 mb-4 border border-border-strong rounded-[100px] bg-bg-card font-mono text-[11px] font-medium text-text-muted tracking-[0.04em]">
          <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">New</span>
          <span>Datasets</span>
        </div>
        <h2 className="text-h2 text-text max-w-[880px] mx-auto text-balance">
          Define once. <span className="text-accent">Reuse everywhere.</span>
        </h2>
        <p className="mt-4 text-body text-text-muted max-w-[680px] mx-auto text-pretty">
          A dataset is your single source of truth for a ClickHouse table. Define the schema, tenant key, time key, and business logic once. Every query across every consumer inherits it automatically.
        </p>
      </div>

      {/* Feature 1: Single Definition */}
      <div className="mb-20">
        <div className="mb-8">
          <h3 className="text-h3 text-text mb-3">One definition, infinite reuse</h3>
          <p className="text-body-sm text-text-muted max-w-[640px]">
            Without datasets, your metrics logic lives in multiple places: raw SQL in dashboards, query builders in API routes, duplicated logic in background jobs. Different definitions across teams. Different assumptions about filters.
          </p>
          <p className="mt-3 text-body-sm text-text-muted max-w-[640px]">
            <strong className="text-text font-semibold">With datasets</strong>, you define the table once. Every consumer—APIs, jobs, dashboards, AI agents—queries the same definition. Refactor once, update everywhere.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3.5">
          {/* Definition */}
          <div className="overflow-hidden rounded-lg border border-border-strong bg-bg-card shadow-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-3">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
              <span className="ml-3.5 font-mono text-[11.5px] text-text-muted">datasets/orders.ts</span>
              <span className="ml-auto font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-accent bg-accent-soft px-2 py-0.5 rounded-sm">Single source of truth</span>
            </div>
            <div className="p-4 bg-bg-card">
              <CodeHighlight
                code={DATASET_DEFINITION}
                language="typescript"
                className="[&_code]:text-[13.5px] [&_code]:leading-[1.85]"
              />
            </div>
          </div>

          {/* Three use cases side by side */}
          <div className="grid-responsive-2" style={{ gap: '0.875rem' }}>
            <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
              <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
                <span className="font-mono text-[11px] text-text-muted">API route</span>
              </div>
              <div className="p-4">
                <CodeHighlight
                  code={DATASET_API_USE}
                  language="typescript"
                  className="[&_code]:text-[12.5px] [&_code]:leading-[1.75]"
                />
              </div>
            </div>

            <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
              <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
                <span className="font-mono text-[11px] text-text-muted">Background job</span>
              </div>
              <div className="p-4">
                <CodeHighlight
                  code={DATASET_JOB_USE}
                  language="typescript"
                  className="[&_code]:text-[12.5px] [&_code]:leading-[1.75]"
                />
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
              <span className="font-mono text-[11px] text-text-muted">React dashboard</span>
            </div>
            <div className="p-4">
              <CodeHighlight
                code={DATASET_DASHBOARD_USE}
                language="typescript"
                className="[&_code]:text-[12.5px] [&_code]:leading-[1.75]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Feature 2: Auto Multi-Tenancy */}
      <div className="mb-20">
        <div className="mb-8">
          <h3 className="text-h3 text-text mb-3">Multi-tenancy you can't forget</h3>
          <p className="text-body-sm text-text-muted max-w-[640px]">
            Declare <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">tenantKey: 'tenant_id'</code> on the dataset. Every query—whether in an API, a job, or a React hook—inherits the tenant filter automatically.
          </p>
          <p className="mt-3 text-body-sm text-text-muted max-w-[640px]">
            <strong className="text-text font-semibold">No code review checklist.</strong> No manual WHERE clauses. Strict mode catches missing tenant keys at compile time. If you forget it, TypeScript fails the build.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-5 bg-bg-card border border-border rounded-lg">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">1</div>
            <div className="text-[15px] font-bold text-text mb-2">Declare once</div>
            <p className="text-body-sm text-text-muted">Set <code className="font-mono text-[0.9em]">tenantKey</code> on the dataset. That's it.</p>
          </div>
          <div className="p-5 bg-bg-card border border-border rounded-lg">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">2</div>
            <div className="text-[15px] font-bold text-text mb-2">Auto-inject everywhere</div>
            <p className="text-body-sm text-text-muted">Every query gets the tenant filter. APIs, jobs, dashboards—automatic.</p>
          </div>
          <div className="p-5 bg-bg-card border border-border rounded-lg">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">3</div>
            <div className="text-[15px] font-bold text-text mb-2">Compile-time safety</div>
            <p className="text-body-sm text-text-muted">Forget the tenant key? TypeScript catches it before deploy.</p>
          </div>
        </div>
      </div>

      {/* Feature 3: Time-Series Awareness */}
      <div>
        <div className="mb-8">
          <h3 className="text-h3 text-text mb-3">Time-series aware by default</h3>
          <p className="text-body-sm text-text-muted max-w-[640px]">
            Set <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">timeKey: 'created_at'</code> and every query knows which column represents time. Filter by date ranges efficiently. Group by day, week, or month. ClickHouse-optimized time functions just work.
          </p>
        </div>

        <div className="p-6 bg-bg-card border border-border-strong rounded-lg">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-accent mb-3">Before datasets</div>
              <ul className="space-y-2 text-body-sm text-text-muted">
                <li className="flex items-start gap-2">
                  <span className="text-text-dim mt-1">✗</span>
                  <span>Manually specify time column in every query</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-text-dim mt-1">✗</span>
                  <span>Inconsistent date filtering across consumers</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-text-dim mt-1">✗</span>
                  <span>Time zone handling duplicated everywhere</span>
                </li>
              </ul>
            </div>
            <div>
              <div className="font-mono text-[11px] font-bold tracking-[0.08em] uppercase text-accent mb-3">With datasets</div>
              <ul className="space-y-2 text-body-sm text-text-muted">
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-1">✓</span>
                  <span>Declare <code className="font-mono text-[0.9em]">timeKey</code> once</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-1">✓</span>
                  <span>All queries inherit time-series logic</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-accent mt-1">✓</span>
                  <span>Time functions optimized for ClickHouse</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 text-center">
        <Link
          href="/docs/datasets"
          className="inline-flex items-center gap-2 bg-text text-bg px-6 py-3 text-[14px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
        >
          Read the datasets docs →
        </Link>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Serve — single full-width code section
   ════════════════════════════════════════════════════════════ */
const SERVE_CODE = `import { initServe } from '@hypequery/serve';
import { Users } from './datasets';
import { z } from 'zod';

const activeUsers = query({
  description: 'Most recent active users',
  dataset: Users,
  input: z.object({
    limit: z.number().min(1).max(100).default(10),
  }),
  query: ({ ctx, input }) => Users.query()
    .where('status', 'eq', 'active')
    .orderBy('created_at', 'DESC')
    .limit(input.limit)
    .execute(),
});

serve({ activeUsers });
// Typed HTTP route and React hook. That is it.`;

function Serve() {
  return (
    <section className="max-w-[1080px] mx-auto px-8 py-[96px]">
      <div className="mb-12">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Serve</p>
        <h2 className="text-h2 text-text max-w-[680px] text-balance">
          Turn any query or dataset into a typed HTTP API in one line.
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[560px] text-pretty">
          Pass a query or dataset into <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">serve()</code>. You get a typed REST route, an OpenAPI spec, and a React hook from the <strong className="text-text font-semibold">same definition you already wrote</strong>. No controllers, no serialisers, no glue code.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-strong bg-bg-alt shadow-card dark:bg-bg-code">
        <div className="flex items-center gap-1.5 border-b border-border bg-bg-card/60 px-4 py-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
          <span className="ml-3.5 font-mono text-[11.5px] text-text-dim dark:text-white/60">serve.ts</span>
          <span className="ml-auto font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-accent bg-accent-soft px-2 py-0.5 rounded-sm">one line</span>
        </div>
        <div className="p-4">
          <div className="rounded-lg border border-border bg-[linear-gradient(180deg,rgba(235,231,223,0.9),rgba(245,243,238,0.92))] px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            <CodeHighlight
              code={SERVE_CODE}
              language="typescript"
              className="[&_code]:text-[13.5px] [&_code]:leading-[1.85]"
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-bg-card/60 px-5 py-3.5 font-mono text-[11px] text-text-dim dark:border-white/[0.07] dark:bg-white/[0.02] dark:text-white/55">
          <span><strong className="text-text font-semibold dark:text-white/85">serve.ts</strong> · same contract, every consumer</span>
          <a className="border-b border-border-strong pb-px text-[11.5px] font-semibold text-text transition hover:border-text dark:border-white/40 dark:text-white/95 dark:hover:border-white/95">Serve docs →</a>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Stack — framework picker + code panel
   ════════════════════════════════════════════════════════════ */
const FRAMEWORKS = [
  { id: 'nextjs', mark: 'N', name: 'Next.js', meta: 'app/api · route handlers', desc: 'Use directly in route handlers or server actions.' },
  { id: 'hono', mark: 'H', name: 'Hono', meta: 'edge & node runtime', desc: 'Mount on any Hono app — Cloudflare, Deno, Bun, Node.' },
  { id: 'express', mark: 'E', name: 'Express', meta: 'middleware adapter', desc: 'Drop-in middleware for existing Express APIs.' },
  { id: 'node', mark: '⬢', name: 'Node.js', meta: 'plain functions', desc: 'No framework? Call the SDK directly from any handler.' },
  { id: 'bun', mark: 'B', name: 'Bun', meta: 'native fetch server', desc: 'Works with Bun.serve and Hono on Bun out of the box.' },
  { id: 'queues', mark: 'Q', name: 'Workers & jobs', meta: 'cron · queues · cli', desc: 'Same SDK in BullMQ, Inngest, Temporal, or a CLI script.' },
];

const STACK_CODE = {
  nextjs: `// app/api/analytics/[metric]/route.ts
import { api } from '@/lib/api';

export const { POST } = api.toNextHandler();
//  ↑ Auto-routed under /api/analytics/*`,
  hono: `// server.ts (Hono)
import { Hono } from 'hono';
import { api } from './lib/api';

const app = new Hono();
app.route('/api/analytics', api.toHono());
export default app;`,
  express: `// server.ts (Express)
import express from 'express';
import { api } from './lib/api';

const app = express();
app.use(express.json());
app.use('/api/analytics', api.toExpress());
app.listen(3000);`,
  node: `// handler.ts (plain Node)
import { createServer } from 'node:http';
import { api } from './lib/api';

createServer(api.toNodeHandler()).listen(3000);`,
  bun: `// server.ts (Bun)
import { api } from './lib/api';

Bun.serve({ port: 3000, fetch: api.toFetch() });`,
  queues: `// jobs/refresh-cache.ts
import { Worker } from 'bullmq';
import { totalRevenue } from '@/metrics';

new Worker('analytics', async (job) => {
  return totalRevenue.run({ ctx: { db }, input: job.data });
});`,
};

function Stack() {
  const [active, setActive] = useState('nextjs');
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[96px]">
      <div className="mb-12">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Integrations</p>
        <h2 className="text-h2 text-text max-w-[680px] text-balance">Runs where your code already runs.</h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[560px] text-pretty">
          hypequery is <strong className="text-text font-semibold">a library, not a platform</strong>. It runs inside your existing backend with your existing auth, logging, and infrastructure. <strong className="text-text font-semibold">If your code runs there, hypequery runs there.</strong>
        </p>
      </div>

      <div className="grid-responsive-stack items-stretch">
        <div className="grid grid-cols-2 gap-2.5">
          {FRAMEWORKS.map(fw => (
            <button
              key={fw.id}
              onClick={() => setActive(fw.id)}
              className={`text-left p-4 rounded-lg border transition flex flex-col gap-2 ${active === fw.id
                ? 'border-text bg-bg-card shadow'
                : 'border-border bg-bg-card hover:border-border-strong hover:-translate-y-px'
                }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-[30px] h-[30px] rounded-md grid place-items-center font-mono text-[13px] font-bold shrink-0 ${active === fw.id ? 'bg-text text-bg' : 'bg-accent-soft text-accent'
                  }`}>{fw.mark}</div>
                <div className="flex flex-col">
                  <span className="text-[14.5px] font-bold text-text -tracking-snug">{fw.name}</span>
                  <span className="font-mono text-[10.5px] text-text-dim tracking-[0.04em]">{fw.meta}</span>
                </div>
              </div>
              <div className="text-[12.5px] text-text-muted leading-snug">{fw.desc}</div>
            </button>
          ))}
        </div>

        <div className="flex min-h-[380px] flex-col overflow-hidden rounded-lg border border-border-strong bg-bg-alt shadow-card dark:bg-bg-code">
          <div className="flex items-center gap-2.5 border-b border-border bg-bg-card/60 px-4 py-3 font-mono text-[11px] text-text-dim dark:border-white/[0.07] dark:bg-white/[0.02] dark:text-white/55">
            <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm">
              {FRAMEWORKS.find(f => f.id === active)?.name}
            </span>
            <span>{active === 'queues' ? 'jobs/refresh-cache.ts' : active === 'nextjs' ? 'app/api/analytics/route.ts' : 'server.ts'}</span>
          </div>
          <div className="p-4 flex-1">
            <div className="h-full rounded-lg border border-border bg-[linear-gradient(180deg,rgba(235,231,223,0.9),rgba(245,243,238,0.92))] px-6 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
              <CodeHighlight
                code={STACK_CODE[active as keyof typeof STACK_CODE]}
                language="typescript"
                className="[&_code]:text-[13.5px] [&_code]:leading-[1.85]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Quote
   ════════════════════════════════════════════════════════════ */
function Quote() {
  return (
    <section className="py-20 px-8 border-y border-border bg-bg-alt">
      <div className="max-w-[880px] mx-auto text-center">
        <div className="font-sans text-[80px] leading-[0.6] text-accent/40 mb-2">"</div>
        <p className="text-[clamp(22px,2.5vw,32px)] font-semibold tracking-tight leading-[1.32] text-text text-balance">
          hypequery let us delete a folder of fragile SQL strings and replace it with one typed definition. Every dashboard, job, and API now agrees on what "active user" means.
        </p>
        <div className="mt-6 inline-flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-accent text-bg grid place-items-center font-bold text-sm font-mono">AK</div>
          <div className="text-left">
            <div className="text-[13.5px] font-semibold text-text">Alex Klein, Staff Engineer</div>
            <div className="text-xs text-text-muted mt-0.5">Northwind Analytics</div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Marquee
   ════════════════════════════════════════════════════════════ */
const MARQUEE_ITEMS = [
  { mark: 'ACME', text: 'Replaced 40+ raw SQL endpoints with typed queries' },
  { mark: 'NORTHWIND', text: '12 datasets · zero duplicated metrics' },
  { mark: 'BLAKE', text: 'Same queries powering API, jobs, and React' },
  { mark: 'CONTOSO', text: 'Multi-tenant analytics for 300+ accounts' },
  { mark: 'MERIDIAN', text: 'Datasets shared between web app and notebooks' },
  { mark: 'OBELIX', text: 'Type-safe queries — refactor without fear' },
];

function Marquee() {
  return (
    <div className="border-y border-border py-6 overflow-hidden relative
                    before:absolute before:top-0 before:bottom-0 before:left-0 before:w-32 before:z-10 before:pointer-events-none before:bg-gradient-to-r before:from-bg before:to-transparent
                    after:absolute  after:top-0  after:bottom-0  after:right-0  after:w-32  after:z-10  after:pointer-events-none  after:bg-gradient-to-l  after:from-bg  after:to-transparent">
      <div className="flex gap-16 w-max animate-marquee">
        {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((m, i) => (
          <div key={i} className="flex items-center gap-3.5 text-sm text-text-muted whitespace-nowrap">
            <span className="font-mono text-[11px] font-bold tracking-[0.05em] text-text bg-bg-card border border-border-strong px-2.5 py-1 rounded-sm">{m.mark}</span>
            <span className="font-medium">{m.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Cloud — eyebrow + headline + live-route observability mockup
   ════════════════════════════════════════════════════════════ */
const CLOUD_ROUTES = [
  { method: 'POST', route: '/api/active-users', stat: '12,481 req · 18ms' },
  { method: 'POST', route: '/api/revenue-by-plan', stat: '3,204 req · 42ms' },
  { method: 'GET', route: '/api/churn-cohort', stat: 'p99 · 1.2s ⚠', alert: true },
  { method: 'POST', route: '/api/funnel', stat: '812 req · 88ms' },
];

function Cloud() {
  return (
    <section id="cloud" className="mx-auto max-w-[1280px] px-8 py-[96px] border-t border-border">
      <div className="grid-responsive-2 items-center" style={{ gap: '4rem' }}>
        <div>
          <p className="font-mono text-eyebrow text-accent mb-3.5 flex items-center gap-2.5">
            <span>Cloud</span>
            <span className="text-[9.5px] font-bold tracking-[0.12em] uppercase text-accent bg-accent-soft px-1.5 py-0.5 rounded-sm normal-case tracking-normal">
              Coming soon
            </span>
          </p>
          <h2 className="text-h2 text-text max-w-[620px] text-balance">
            Query observability and hosted APIs for your ClickHouse datasets.
          </h2>
          <p className="mt-3.5 text-body text-text-muted max-w-[560px] text-pretty">
            hypequery cloud is the managed layer on top of everything you have already built. Connect your ClickHouse instance, point it at your dataset definitions, and get <strong className="text-text font-semibold">hosted API endpoints, query logging, slow query alerts, and a dashboard</strong> showing exactly what is hitting your database and what it costs.
          </p>
          <p className="mt-3.5 text-body text-text-muted max-w-[560px] text-pretty">
            No migration. No rewrite. If you are already using hypequery the transition is a single configuration change.
          </p>
          <p className="mt-3.5 text-body-sm text-text-dim max-w-[560px]">
            The core SDK is MIT licensed and free forever. Cloud is for teams that want managed infrastructure and observability on top of it.
          </p>
          <div className="mt-7 flex gap-2.5 flex-wrap">
            <button className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px">
              Join the waitlist →
            </button>
            <button className="bg-transparent text-text px-5 py-3 text-[13.5px] font-semibold rounded border border-border-strong transition hover:border-text hover:bg-bg-alt">
              See what's included
            </button>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-[520px] bg-bg-code border border-border-strong rounded-lg overflow-hidden shadow-card">
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.07] bg-white/[0.02]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
              <span className="ml-3.5 font-mono text-[11.5px] text-white/60">cloud.hypequery.com</span>
              <span className="ml-auto w-1.5 h-1.5 rounded-full bg-success shadow-glow" />
            </div>
            <div className="px-5 py-4 flex flex-col gap-2">
              {CLOUD_ROUTES.map(r => (
                <div
                  key={r.route}
                  className={`grid grid-cols-[50px_1fr_auto] gap-3.5 items-center px-3 py-2 rounded font-mono text-[11.5px] border ${r.alert
                    ? 'bg-[#fbbf24]/[0.07] border-[#fbbf24]/25'
                    : 'bg-white/[0.03] border-white/[0.06]'
                    }`}
                >
                  <span className={`font-bold text-[10px] tracking-wide ${r.alert ? 'text-[#fbbf24]' : 'text-accent'}`}>
                    {r.method}
                  </span>
                  <span className="text-white/95">{r.route}</span>
                  <span className={`text-[10.5px] ${r.alert ? 'text-[#fbbf24]' : 'text-white/50'}`}>{r.stat}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center px-5 py-3 border-t border-white/[0.07] bg-white/[0.02] font-mono text-[10.5px] text-white/50">
              <span>live · last 24h</span>
              <span className="ml-auto text-accent font-semibold tracking-[0.1em]">SLO 99.9%</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Final CTA
   ════════════════════════════════════════════════════════════ */
function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-20 text-center">
      <h2 className="text-h1 text-text max-w-[780px] mx-auto text-balance">
        Start with a query. Add a dataset when it matters. Serve it when you are ready.
      </h2>
      <p className="mt-[18px] mx-auto inline-block">
        <span className="font-mono text-[15px] text-text bg-bg-alt border border-border-strong px-3.5 py-2 rounded">
          npm install @hypequery/clickhouse
        </span>
      </p>
      <div className="mt-8 flex gap-2.5 justify-center flex-wrap">
        <Link
          href="/docs/quick-start"
          onClick={() => trackUmamiEvent('cta_click', { target: 'docs_quick_start', location: 'final_cta', page: '/' })}
          className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
        >
          View quickstart →
        </Link>
        <Link
          href="/docs"
          onClick={() => trackUmamiEvent('cta_click', { target: 'docs_home', location: 'final_cta', page: '/' })}
          className="bg-transparent text-text px-5 py-3 text-[13.5px] font-semibold rounded border border-border-strong transition hover:border-text hover:bg-bg-alt"
        >
          Read the docs
        </Link>
      </div>
    </section>
  );
}

/* ════════════════════════════════════════════════════════════
   Page composition
   ════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════
   Announcement Banner
   ════════════════════════════════════════════════════════════ */
function AnnouncementBanner() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] overflow-hidden bg-gradient-to-r from-accent via-[#5b61d6] to-accent text-white py-2.5 border-b-2 border-white/20 shadow-lg">
      <div className="animate-marquee whitespace-nowrap inline-block text-[13px] font-medium">
        <span className="inline-block px-12">
          🚀 <strong className="font-bold">We've launched Datasets!</strong> Your semantic layer in code — define your ClickHouse tables once, reuse them across APIs, jobs, dashboards, and AI agents →
        </span>
        <span className="inline-block px-12">
          🚀 <strong className="font-bold">We've launched Datasets!</strong> Your semantic layer in code — define your ClickHouse tables once, reuse them across APIs, jobs, dashboards, and AI agents →
        </span>
        <span className="inline-block px-12">
          🚀 <strong className="font-bold">We've launched Datasets!</strong> Your semantic layer in code — define your ClickHouse tables once, reuse them across APIs, jobs, dashboards, and AI agents →
        </span>
        <span className="inline-block px-12">
          🚀 <strong className="font-bold">We've launched Datasets!</strong> Your semantic layer in code — define your ClickHouse tables once, reuse them across APIs, jobs, dashboards, and AI agents →
        </span>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <AnnouncementBanner />
      <Navigation />
      <main className="pt-[98px]">
        <Hero />
        <Why />
        <Capabilities />
        <DatasetsDeepDive />
        <Stack />
        <Cloud />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
