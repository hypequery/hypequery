'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { useCaseExamples as useCaseExamplesRaw } from '@/data/homepage-content';

const queryBuilderCode = `import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './analytics/schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USERNAME!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE!,
});

const latestUsers = await db
  .table('users')
  .select(['id', 'email', 'created_at'])
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();`;

const wrapQueryCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';

const { query } = initServe({
  context: () => ({ db }),
});

const activeUsers = query({
  description: 'Most recent active users',
  input: z.object({
    limit: z.number().min(1).max(100).default(10),
  }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('users')
      .select(['id', 'email', 'created_at'])
      .where('status', 'eq', 'active')
      .orderBy('created_at', 'DESC')
      .limit(input.limit)
      .execute(),
});

const rows = await activeUsers.execute({
  input: { limit: 10 },
});`;

const addServeCode = `const { query, serve } = initServe({
  auth: apiKeyAuth,
  tenant: {
    extract: (auth) => auth?.tenantId ?? null,
    mode: 'auto-inject',
    column: 'tenant_id',
  },
  context: ({ auth }) => ({ db, auth }),
});

export const api = serve({
  queries: { activeUsers },
});

api.route('/active-users', api.queries.activeUsers);`;

const rawSqlCode = `const result = await client.query({
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

const typeSafeCode = `const result = await db
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

const features = [
  'Typed query definitions you can execute locally',
  'Optional HTTP routes and docs from serve({ queries })',
  'One contract reused across apps, jobs, and dashboards',
  'Safer schema changes through generated ClickHouse types',
  'Auth, multi-tenancy, and caching when your app needs them',
  'Framework-friendly handlers for Next.js and Node',
];

const buildSteps = [
  {
    number: '1. Query builder',
    title: 'Start with a typed ClickHouse query',
    body: 'Start with the query builder when you just want a safe, ergonomic way to query ClickHouse from TypeScript.',
    filename: 'query-builder.ts',
    code: queryBuilderCode,
  },
  {
    number: '2. Wrap query',
    title: 'Turn it into an executable definition',
    body: 'Add a description, typed input and re-use across your codebase.',
    filename: 'query-definition.ts',
    code: wrapQueryCode,
  },
  {
    number: '3. Add serve',
    title: 'Expose the same query over HTTP',
    body: 'Expose as a shared runtime surface for product APIs, dashboards, and multi-tenant apps.',
    filename: 'serve-runtime.ts',
    code: addServeCode,
  },
];

const sectionTitleClass = 'font-display mt-4 text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl';
const panelTitleClass = 'font-display text-2xl font-bold tracking-[-0.03em] text-white';
const cardTitleClass = 'font-display text-xl font-bold tracking-[-0.02em] text-white';

function GitHubIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

function XIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 3H21.5l-7.5 8.568L22 21h-5.156l-4.03-4.888L8.113 21H4.856l7.938-9.06L2.5 3h5.289l3.64 4.523L18.244 3zm-1.804 16.2h1.402L7.56 4.695H6.07l10.37 14.505z" />
    </svg>
  );
}

function LinkedInIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.026-3.037-1.852-3.037-1.853 0-2.137 1.447-2.137 2.943v5.663H9.354V9h3.414v1.561h.047c.476-.9 1.637-1.85 3.37-1.85 3.604 0 4.27 2.372 4.27 5.456v6.285zM5.337 7.433a2.062 2.062 0 01-2.063-2.058A2.062 2.062 0 015.337 3.32a2.062 2.062 0 012.062 2.055 2.062 2.062 0 01-2.062 2.058zM3.56 20.452h3.553V9H3.56v11.452z" />
    </svg>
  );
}

function CodeFrame({
  code,
  filename,
  language = 'typescript',
  className = '',
}: {
  code: string;
  filename: string;
  language?: string;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden border border-white/10 bg-[#0d1117] shadow-[0_24px_70px_rgba(2,6,23,0.45)] ${className}`}
    >
      <div className="flex items-center gap-2 border-b border-white/10 bg-[#0a0e16] px-4 py-2.5 text-[12px] text-slate-300">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="h-2.5 w-2.5 rounded-full bg-slate-600" />
        <span className="ml-2 font-mono text-[11px] tracking-[0.03em] text-slate-400">{filename}</span>
      </div>
      <div className="px-4 pb-4">
        <CodeHighlight code={code} language={language} />
      </div>
    </div>
  );
}

export default function Home() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [selectedUseCase, setSelectedUseCase] = useState(useCaseExamplesRaw[0]);
  const [heroVisible, setHeroVisible] = useState(false);
  const [isDesktopNav, setIsDesktopNav] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setHeroVisible(true);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const syncViewport = () => {
      const nextIsDesktop = window.innerWidth >= 900;
      setIsDesktopNav(nextIsDesktop);
      if (nextIsDesktop) {
        setMobileOpen(false);
      }
    };

    syncViewport();
    window.addEventListener('resize', syncViewport);

    return () => window.removeEventListener('resize', syncViewport);
  }, []);

  return (
    <div className="min-h-screen bg-[#07090f] text-[#e8eaf0]">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#07090f]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="font-mono text-[18px] font-bold tracking-[-0.02em] text-white sm:text-[19px]"
            onClick={() => setMobileOpen(false)}
          >
            &gt; hypequery
          </Link>
          {isDesktopNav ? (
            <nav className="flex items-center gap-6">
              <Link href="/docs" className="text-sm font-medium text-slate-200 transition hover:text-white">
                Docs
              </Link>
              <Link href="/blog" className="text-sm font-medium text-slate-200 transition hover:text-white">
                Blog
              </Link>
              <a
                href="https://github.com/hypequery/hypequery"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-2 text-sm font-medium text-slate-100 transition hover:border-white/20 hover:bg-white/5 hover:text-white"
                aria-label="GitHub"
              >
                <GitHubIcon className="h-4.5 w-4.5" />
                <span>GitHub</span>
              </a>
            </nav>
          ) : (
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center text-slate-300"
              onClick={() => setMobileOpen((value) => !value)}
              aria-label="Toggle navigation"
            >
              <div className="flex flex-col gap-1.5">
                <span className={`h-0.5 w-5 bg-current transition ${mobileOpen ? 'translate-y-2 rotate-45' : ''}`} />
                <span className={`h-0.5 w-5 bg-current transition ${mobileOpen ? 'opacity-0' : ''}`} />
                <span className={`h-0.5 w-5 bg-current transition ${mobileOpen ? '-translate-y-2 -rotate-45' : ''}`} />
              </div>
            </button>
          )}
        </div>
        {!isDesktopNav && mobileOpen ? (
          <div className="border-t border-white/10 bg-[#07090f] px-4 py-4">
            <div className="flex flex-col gap-3">
              <Link href="/docs" className="text-sm font-medium text-slate-300" onClick={() => setMobileOpen(false)}>
                Docs
              </Link>
              <Link href="/blog" className="text-sm font-medium text-slate-300" onClick={() => setMobileOpen(false)}>
                Blog
              </Link>
              <a
                href="https://github.com/hypequery/hypequery"
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-slate-300"
                onClick={() => setMobileOpen(false)}
              >
                GitHub
              </a>
              <Link
                href="/docs/quick-start"
                className="inline-flex w-fit items-center justify-center bg-indigo-500 px-4 py-2 font-mono text-sm font-semibold text-white"
                onClick={() => setMobileOpen(false)}
              >
                Get Started →
              </Link>
            </div>
          </div>
        ) : null}
      </header>

      <main>
        <section className="relative overflow-hidden px-4 pb-20 pt-32 sm:px-6 sm:pt-36">
          <div className="absolute inset-0 bg-[linear-gradient(rgba(99,102,241,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(99,102,241,0.04)_1px,transparent_1px)] bg-[size:60px_60px] [mask-image:radial-gradient(ellipse_80%_70%_at_50%_35%,black_20%,transparent_100%)]" />
          <div
            className={`absolute left-1/2 top-[18%] h-[360px] w-[760px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.16),transparent_70%)] blur-3xl transition-all duration-1000 ${heroVisible ? 'scale-100 opacity-100' : 'scale-90 opacity-0'
              }`}
          />
          <div className="relative mx-auto flex min-h-[calc(100vh-9rem)] max-w-7xl flex-col items-center justify-center text-center">
            <div
              className={`inline-flex items-center gap-2 rounded-full border border-indigo-400/35 bg-indigo-500/10 px-4 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-indigo-200 transition-all duration-700 ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
                }`}
            >
              The Type-Safe Query Builder for ClickHouse
            </div>
            <h1
              className={`font-display mt-8 max-w-5xl text-5xl font-extrabold tracking-[-0.04em] text-white transition-all duration-700 delay-100 sm:text-6xl lg:text-7xl ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
                }`}
            >
              Build ClickHouse queries once.
              <br />
              <span className="text-indigo-400">Reuse them everywhere.</span>
            </h1>
            <p
              className={`mt-6 max-w-2xl text-lg leading-8 text-slate-400 transition-all duration-700 delay-200 ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
                }`}
            >
              Generate types from your schema, build queries with full autocomplete, reuse them across APIs,
              dashboards, and agents.
            </p>
            <div
              className={`mt-10 flex flex-wrap items-center justify-center gap-3 transition-all duration-700 delay-300 ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
                }`}
            >
              <Link
                href="/docs/quick-start"
                className="bg-indigo-500 px-6 py-3 font-mono text-sm font-semibold tracking-[0.02em] text-white transition hover:-translate-y-0.5 hover:bg-indigo-400"
              >
                Get Started in 30 Seconds →
              </Link>
              <a
                href="https://github.com/hypequery/hypequery"
                target="_blank"
                rel="noreferrer"
                className="border border-white/10 px-6 py-3 font-mono text-sm font-semibold tracking-[0.02em] text-slate-100 transition hover:border-white/20 hover:bg-white/5"
              >
                Star on GitHub
              </a>
            </div>
            <p
              className={`mt-8 font-mono text-[11px] uppercase tracking-[0.15em] text-slate-500 transition-all duration-700 delay-[400ms] ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
                }`}
            >
              No YAML · No string-concatenated SQL · No duplicated metrics
            </p>
            <div
              className={`mt-4 flex flex-wrap items-center justify-center gap-2 transition-all duration-700 delay-[500ms] ${heroVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
                }`}
            >
              <Image
                src="https://img.shields.io/npm/dm/@hypequery/clickhouse?color=white&label=downloads&logo=npm&style=flat-square"
                alt="npm downloads"
                width={140}
                height={20}
                className="h-5 w-auto"
                unoptimized
              />
              <Image
                src="https://img.shields.io/badge/TypeScript-007ACC?logo=typescript&logoColor=white&style=flat-square"
                alt="TypeScript"
                width={100}
                height={20}
                className="h-5 w-auto"
                unoptimized
              />
              <Image
                src="https://img.shields.io/badge/ClickHouse-000000?logo=clickhouse&logoColor=FCC624&style=flat-square&labelColor=000000"
                alt="ClickHouse"
                width={110}
                height={20}
                className="h-5 w-auto"
                unoptimized
              />
            </div>
          </div>
        </section>

        <section className="px-4 pb-12 sm:px-6">
          <div className="mx-auto max-w-7xl border-t border-white/10 pt-16">
            <div className="mx-auto max-w-3xl text-center">
              <p className="font-mono text-xs font-semibold uppercase tracking-[0.35em] text-indigo-300">
                Build Path
              </p>
              <h2 className={sectionTitleClass}>
                Grow from one safe query to a reusable analytics API
              </h2>
              <p className="mt-4 text-lg leading-8 text-slate-400">
                hypequery does not force you into a big framework on day one. Start with the query builder, reuse the
                query when it matters, and add <code>serve()</code> when you want HTTP routes, docs, and framework
                integration.
              </p>
            </div>
            <div className="mt-12 border-t border-white/10">
              {buildSteps.map((step, index) => (
                <div
                  key={step.number}
                  className={`grid gap-8 border-b border-white/10 py-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start ${index === 2 ? 'bg-indigo-500/[0.03]' : ''
                    }`}
                >
                  <div className="px-1">
                    <p className="font-mono text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                      {step.number}
                    </p>
                    <h3 className={`${panelTitleClass} mt-4`}>{step.title}</h3>
                    <p className="mt-4 max-w-xl text-base leading-8 text-slate-400">{step.body}</p>
                  </div>
                  <CodeFrame code={step.code} filename={step.filename} />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 pb-12 pt-8 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.35em] text-indigo-300">
              Why teams move beyond raw SQL
            </p>
            <h2 className={sectionTitleClass}>
              Type-safe, reusable, consistent
            </h2>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-400">
              Keep ClickHouse queries type-safe, reusable, and consistent across dashboards, APIs, jobs, and internal
              tools.
            </p>
            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="border border-white/10 bg-[#0d1117] p-6">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">The old way</p>
                <h3 className={`${panelTitleClass} mt-4`}>YAML. SQL strings.</h3>
                <ul className="mt-5 space-y-4 text-base leading-8 text-slate-300">
                  <li>Query logic scattered across dashboards, scripts, and services.</li>
                  <li>String-concatenated SQL that drifts as schemas evolve.</li>
                  <li>Metrics definitions duplicated and re-implemented per team.</li>
                </ul>
                <CodeFrame code={rawSqlCode} filename="raw-sql.ts" className="mt-6" />
              </div>
              <div className="border border-indigo-500/35 bg-[#0a0f1d] p-6">
                <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
                  The hypequery way
                </p>
                <h3 className={`${panelTitleClass} mt-4`}>Everything is code.</h3>
                <ul className="mt-5 space-y-4 text-base leading-8 text-slate-300">
                  <li>Type-safe metrics defined once in TypeScript.</li>
                  <li>Reusable definitions power APIs, jobs, dashboards, and agents.</li>
                  <li>Auth, multi-tenancy, and caching stay consistent everywhere.</li>
                </ul>
                <CodeFrame code={typeSafeCode} filename="type-safe-query.ts" className="mt-6" />
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-12 pt-8 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.35em] text-indigo-300">
              Pick a use case
            </p>
            <h2 className={sectionTitleClass}>
              The API shape stays the same.
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-400">The thing that changes is where you use it.</p>
            <div className="mt-10 grid gap-4 lg:grid-cols-4">
              {useCaseExamplesRaw.map((useCase) => {
                const active = selectedUseCase.id === useCase.id;
                return (
                  <button
                    key={useCase.id}
                    type="button"
                    onClick={() => setSelectedUseCase(useCase)}
                    className={`border p-5 text-left transition ${active
                      ? 'border-indigo-400 bg-indigo-500/[0.06] shadow-[0_0_0_1px_rgba(129,140,248,0.22)]'
                      : 'border-white/10 bg-[#0d1117] hover:border-white/20'
                      }`}
                  >
                    <h3 className={cardTitleClass}>{useCase.title}</h3>
                    <p className="mt-3 text-sm leading-7 text-slate-400">{useCase.summary}</p>
                  </button>
                );
              })}
            </div>
            <div className="mt-8 border border-white/10 bg-[#0d1117] p-6 shadow-[0_24px_70px_rgba(2,6,23,0.35)]">
              <h3 className={panelTitleClass}>{selectedUseCase.title}</h3>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-400">{selectedUseCase.body}</p>
              <CodeFrame
                code={selectedUseCase.code}
                filename="example.ts"
                language={selectedUseCase.codeLanguage}
                className="mt-6"
              />
            </div>
          </div>
        </section>

        <section className="px-4 pb-12 pt-8 sm:px-6">
          <div className="mx-auto max-w-7xl">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.35em] text-indigo-300">What you get</p>
            <h2 className={sectionTitleClass}>
              When you need more than a query builder
            </h2>
            <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature) => (
                <div key={feature} className="border border-white/10 bg-[#0d1117] px-6 py-5">
                  <h3 className={cardTitleClass}>{feature}</h3>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-14 sm:px-6">
          <div className="mx-auto max-w-6xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.15),transparent_45%),#0d1117] px-6 py-14 text-center shadow-[0_24px_80px_rgba(2,6,23,0.35)] sm:px-10">
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Ship faster</p>
            <h2 className="font-display mt-4 text-3xl font-bold tracking-[-0.03em] text-white sm:text-5xl">
              Build your first type-safe query
              <br />
              in 30 seconds
            </h2>
            <p className="mx-auto mt-5 max-w-3xl text-lg leading-8 text-slate-400">
              Get started with the query builder, then add HTTP APIs and team features when you need them. Teams use it
              to keep product analytics, finance APIs, and AI agents perfectly in sync.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/docs/quick-start"
                className="bg-indigo-500 px-6 py-3 font-mono text-sm font-semibold tracking-[0.02em] text-white transition hover:-translate-y-0.5 hover:bg-indigo-400"
              >
                Get started →
              </Link>
              <Link
                href="/docs"
                className="border border-white/10 px-6 py-3 font-mono text-sm font-semibold tracking-[0.02em] text-slate-100 transition hover:border-white/20 hover:bg-white/5"
              >
                Explore docs
              </Link>
            </div>
            <p className="mt-6 text-base text-slate-400">
              Early adopter? DM us{' '}
              <a href="https://x.com/hypequery" target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200">
                @hypequery
              </a>{' '}
              — let&apos;s build this together.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Link href="/" className="font-mono text-[15px] font-bold tracking-[-0.02em] text-white">
              &gt; hypequery
            </Link>
            <p className="mt-3 max-w-md text-sm leading-7 text-slate-400">
              The type-safe query builder for ClickHouse. Build queries once, reuse them across product APIs,
              dashboards, jobs, and agents.
            </p>
          </div>
          <div className="flex flex-col gap-5 lg:items-end">
            <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
              <Link href="/docs" className="transition hover:text-white">
                Docs
              </Link>
              <Link href="/clickhouse-typescript" className="transition hover:text-white">
                ClickHouse TypeScript
              </Link>
              <Link href="/blog" className="transition hover:text-white">
                Blog
              </Link>
              <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noreferrer" className="transition hover:text-white">
                GitHub
              </a>
            </div>
            <p className="text-sm text-slate-500">
              Feedback?{' '}
              <a
                href="https://github.com/hypequery/hypequery/issues"
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 transition hover:text-white"
              >
                Open an issue
              </a>{' '}
              or DM{' '}
              <a href="https://x.com/hypequery" target="_blank" rel="noreferrer" className="text-slate-400 transition hover:text-white">
                @hypequery
              </a>
              .
            </p>
          </div>
        </div>
        <div className="mx-auto mt-8 flex max-w-7xl flex-col gap-4 border-t border-white/10 pt-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 hypequery. All rights reserved.</span>
          <div className="flex items-center gap-4 text-slate-400">
            <a href="https://github.com/hypequery/hypequery" target="_blank" rel="noreferrer" className="transition hover:text-white">
              <GitHubIcon />
            </a>
            <a href="https://x.com/hypequery" target="_blank" rel="noreferrer" className="transition hover:text-white">
              <XIcon />
            </a>
            <a
              href="https://www.linkedin.com/company/110435355/"
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-white"
            >
              <LinkedInIcon />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
