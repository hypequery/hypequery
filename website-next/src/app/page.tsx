'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Star } from 'lucide-react';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeHighlight from '@/components/CodeHighlight';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import {
  CodeBlockTabs,
  CodeBlockTab,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from 'fumadocs-ui/components/codeblock';
import { Steps, Step } from 'fumadocs-ui/components/steps';
import { useCaseExamples as useCaseExamplesRaw } from '@/data/homepage-content';
import { CopyButton } from '@/components/CopyButton';

export default function Home() {
  const [selectedUseCase, setSelectedUseCase] = useState(useCaseExamplesRaw[0]);
  const [terminalText, setTerminalText] = useState('');
  const apiCode = `import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './analytics/client';

const { define, query } = initServe({
  context: () => ({ db }),
});

export const api = define({
  queries: {
    weeklyRevenue: query
      .describe('Weekly revenue totals')
      .input(z.object({ startDate: z.string() }))
      .query(({ ctx, input }) =>
        ctx.db
          .table('orders')
          .where('created_at', 'gte', input.startDate)
          .groupBy(['week'])
          .sum('total', 'revenue')
          .execute()
      ),
  },
});`;

  const authCode = `import { z } from 'zod';

export const authHeader = z.string().min(1);

export function requireAuth(req: Request) {
  const token = authHeader.parse(req.headers.get('authorization'));
  if (!token.startsWith('Bearer ')) {
    throw new Error('Unauthorized');
  }
  return { token: token.replace('Bearer ', '') };
}`;
  const aiAgentCardCode = `const catalog = api.describe();
const tools = new Set(catalog.queries.map((q) => q.key));

const result = await api.run('weeklyRevenue', {
  request: { headers: { authorization: 'Bearer token' } },
});`;
  const httpCardCode = `import { createFetchHandler } from '@hypequery/serve';

api.route('/weekly-revenue', api.queries.weeklyRevenue);

const handler = createFetchHandler(api.handler);`;
  const reactCardCode = `import { createHooks } from '@hypequery/react';

export const { useQuery } = createHooks<ApiDefinition>({
  baseUrl: '/api/hypequery',
});

const { data } = useQuery('weeklyRevenue', { startDate: '2026-01-01' });`;
  const inProcessCardCode = `const latest = await api.run('activeUsers', {
  input: { limit: 25 },
  request: { headers: { authorization: 'Bearer token' } },
});`;

  const terminalLines = [
    'Connecting to ClickHouse...',
    'Found 47 tables',
    'Generating TypeScript types from your schema...',
    'Created analytics/schema.ts',
    'Created analytics/client.ts',
    'Created analytics/queries.ts',
    '',
    '🎉 Done! Your analytics backend is ready.',
    '',
    'Run: npm run dev',
  ];

  useEffect(() => {
    let lineIndex = 0;
    let charIndex = 0;
    let currentText = '';

    const typeNextChar = () => {
      if (lineIndex < terminalLines.length) {
        const currentLine = terminalLines[lineIndex];

        if (charIndex < currentLine.length) {
          currentText += currentLine[charIndex];
          charIndex++;
          setTerminalText(currentText);
          setTimeout(typeNextChar, 15 + Math.random() * 30);
        } else {
          currentText += '\n';
          lineIndex++;
          charIndex = 0;
          setTerminalText(currentText);
          setTimeout(typeNextChar, 100);
        }
      }
    };

    const startDelay = setTimeout(() => {
      typeNextChar();
    }, 800);

    return () => clearTimeout(startDelay);
  }, []);

  return (
    <>
      <Navigation />
      <main className="home-page">
        {/* Hero section */}
        <div className="relative isolate bg-[#0b1120] pt-14 text-gray-100">
          <div className="pt-24 pb-8">
            <div className="mx-auto max-w-7xl px-4 lg:px-6">
              <div className="flex flex-col items-start md:flex-row relative">
                <div className="max-w-3xl pb-12 relative z-10">
                  <div className="inline-flex items-center gap-2 mb-4">
                    <div className="inline-flex items-center bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">
                      The Type-Safe Query Builder for ClickHouse
                    </div>
                  </div>
                  <h1 className="font-display text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl dark:text-gray-100">
                    Ship analytics across your entire stack
                  </h1>
                  <div>
                    <p className="mt-4 text-lg leading-8 text-gray-600 dark:text-gray-300">
                      Build type-safe ClickHouse queries in seconds. Start simple, add governance when you scale.
                    </p>
                    <p className="mt-2 text-lg leading-8 text-gray-600 dark:text-gray-300 font-medium">
                      Start with the query builder. Add serve when you need teams.
                    </p>
                  </div>
                  <div className="mt-8 space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <Link
                        href="/docs/standalone-query-builder/setup"
                        className="bg-indigo-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-indigo-500 font-mono"
                      >
                        Get Started in 30 Seconds →
                      </Link>
                      <a
                        href="https://github.com/hypequery/hypequery"
                        className="inline-flex items-center gap-2 border border-gray-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-gray-100 transition hover:bg-white/10 font-mono"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Star on GitHub
                      </a>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium uppercase tracking-wide text-gray-500">
                    No YAML · No string-concatenated SQL · No duplicated metrics
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
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

                {/* Hero mascot and terminal - only show on large screens */}
                <div className="block hidden:md hero-mascot-wrapper">
                  <div className="absolute right-95 top-45">
                    <Image
                      src="/mascot_dark.jpeg"
                      alt="hypequery mascot"
                      width={256}
                      height={256}
                      className="hero-mascot-dark h-64 w-auto object-contain block"
                    />
                  </div>
                  <div className="absolute right-0 top-10 -translate-y-1/4">
                    <div className="relative w-[410px] min-h-[250px] border border-gray-800 bg-gray-950 px-5 py-4 text-sm text-green-300 shadow-2xl">
                      <div className="flex items-center justify-between gap-3 font-mono">
                        <span>
                          <span className="text-gray-500">$ </span>
                          <span>npx hypequery init</span>
                        </span>
                        <CopyButton text="npx hypequery init" className="min-w-[96px] px-2 py-1" />
                      </div>
                      <div className="mt-3 min-h-[110px] space-y-2 font-mono text-xs text-emerald-200/80 whitespace-pre-wrap">
                        {terminalText}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Architecture explainer */}
              {/* <HypequeryArchitecture /> */}
            </div>
          </div>
        </div>

        {/* Progression section */}
        <div className="bg-gray-50 py-16 dark:bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <div className="text-center">
              <h2 className="font-display text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                Start Simple, Scale When Ready
              </h2>
              <p className="mt-4 text-lg text-gray-600 dark:text-gray-300">
                Progress from quick queries to governed APIs without rewriting code
              </p>
            </div>
            <div className="mt-12 grid gap-8 md:grid-cols-3">
              <div className="border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">
                    1
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Query Builder
                  </h3>
                </div>
                <p className="mt-4 text-base text-gray-600 dark:text-gray-300">
                  Build type-safe ClickHouse queries in seconds. Perfect for dashboards, internal tools, and scripts.
                </p>
                <div className="mt-4">
                  <Link
                    href="/docs/standalone-query-builder/setup"
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    Get started →
                  </Link>
                </div>
              </div>
              <div className="border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">
                    2
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Add Serve
                  </h3>
                </div>
                <p className="mt-4 text-base text-gray-600 dark:text-gray-300">
                  Need HTTP APIs? Wrap queries with serve for authentication, multi-tenancy, and OpenAPI docs.
                </p>
                <div className="mt-4">
                  <Link
                    href="/docs/serve-runtime"
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    Learn more →
                  </Link>
                </div>
              </div>
              <div className="border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold">
                    3
                  </div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    Team Features
                  </h3>
                </div>
                <p className="mt-4 text-base text-gray-600 dark:text-gray-300">
                  Scale with governance: role-based access, audit logs, and advanced compliance features.
                </p>
                <div className="mt-4">
                  <Link
                    href="/docs/authentication"
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                  >
                    Explore features →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white py-20 dark:bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 lg:px-6 text-gray-900 dark:text-gray-100">
            {/* Everything is code section */}
            <section className="mb-20">
              <div className="grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-600 dark:text-indigo-400">
                    Everything is code
                  </p>
                  <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
                    From ClickHouse schema to governed APIs in minutes
                  </h2>
                  <p className="mt-4 text-base md:text-lg leading-7 text-gray-600 dark:text-gray-300">
                    A quick path from your ClickHouse schema to a typed, governed API without YAML,
                    without SQL strings.
                  </p>
                  <div className="mt-8">
                    <Steps>
                      <Step>
                        <div className="flex flex-col gap-3 pb-12">
                          <p className="text-lg font-medium text-gray-100">Scaffold new or drop into your existing codebase.</p>
                          <div className="flex items-center justify-between gap-3 border border-gray-700 bg-[#0a0f1d] px-4 py-3 font-mono text-base text-gray-200">
                            <span>$ npx hypequery init</span>
                            <CopyButton text="npx hypequery init" className="min-w-[96px] px-2 py-1" />
                          </div>
                        </div>
                      </Step>
                      <Step>
                        <div className="flex flex-col gap-2 pb-12">
                          <p className="text-lg font-semibold text-gray-100">Define</p>
                          <p className="text-base text-gray-300">Define type-safe queries with our ClickHouse-native query builder.</p>
                        </div>
                      </Step>
                      <Step>
                        <div className="flex flex-col gap-2">
                          <p className="text-lg font-semibold text-gray-100">Consume</p>
                          <p className="text-base text-gray-300">
                            Run via our built-in server or embed in your backend, then consume across your stack.
                          </p>
                        </div>
                      </Step>
                    </Steps>
                  </div>
                </div>
                <div className="">
                  <CodeBlockTabs className="rounded-none" defaultValue="queries">
                    <CodeBlockTabsList>
                      <CodeBlockTabsTrigger value="queries">
                        analytics/queries.ts
                      </CodeBlockTabsTrigger>
                      <CodeBlockTabsTrigger value="auth">auth.ts</CodeBlockTabsTrigger>
                    </CodeBlockTabsList>
                    <CodeBlockTab value="queries" title="analytics/queries.ts">
                      <DynamicCodeBlock
                        lang="ts"
                        code={apiCode}
                        codeblock={{ className: 'h-[500px] text-sm hq-codeblock hq-highlight' }}
                      />
                    </CodeBlockTab>
                    <CodeBlockTab value="auth" title="auth.ts">
                      <DynamicCodeBlock
                        lang="ts"
                        code={authCode}
                        codeblock={{ className: 'hq-codeblock' }}
                      />
                    </CodeBlockTab>
                  </CodeBlockTabs>

                </div>
              </div>
              <div className="mt-8">
                <div className="mt-6 feature-grid feature-grid-runtime overflow-hidden border border-gray-700">
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      AI Agent
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">
                      Callable by AI agents
                    </p>
                    <p className="mt-3 text-sm text-gray-300">
                      Give agents governed, typed access to metrics without raw SQL.
                    </p>
                    <div className="mt-5 -mx-4 md:-mx-6 bg-[#1f2937]">
                      <DynamicCodeBlock
                        lang="ts"
                        code={aiAgentCardCode}
                        codeblock={{ className: 'hq-codeblock mini-card-code hq-highlight text-sm max-h-44 overflow-auto' }}
                      />
                    </div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      HTTP
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Expose via HTTP</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Auto-generated endpoints with auth and OpenAPI baked in.
                    </p>
                    <div className="mt-5 -mx-4 md:-mx-6 bg-[#1f2937]">
                      <DynamicCodeBlock
                        lang="ts"
                        code={httpCardCode}
                        codeblock={{ className: 'radius-none hq-codeblock mini-card-code hq-highlight text-sm max-h-44 overflow-auto' }}
                      />
                    </div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      React
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Consume in React</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Typed hooks and SDKs keep UI and metrics in sync.
                    </p>
                    <div className="mt-5 -mx-4 md:-mx-6 bg-[#1f2937]">
                      <DynamicCodeBlock
                        lang="ts"
                        code={reactCardCode}
                        codeblock={{ className: 'hq-codeblock mini-card-code hq-highlight text-sm max-h-44 overflow-auto' }}
                      />
                    </div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="font-display text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      In-Process
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Run in process</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Call metrics directly inside jobs, scripts, or services.
                    </p>
                    <div className="mt-5 -mx-4 md:-mx-6 bg-[#1f2937]">
                      <DynamicCodeBlock
                        lang="ts"
                        code={inProcessCardCode}
                        codeblock={{ className: 'hq-codeblock mini-card-code hq-highlight text-sm max-h-44 overflow-auto' }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* The cost of raw SQL */}
            <section className="mt-20" id="solutions">
              <h2 className="font-display text-3xl font-bold tracking-tight text-gray-100">
                Raw SQL breaks as teams scale
              </h2>
              <p className="mt-3 text-base text-gray-300">
                When every dashboard, service, and script ships its own SQL, metrics drift and trust
                disappears. The same definition should power every surface.
              </p>
              <div className="mt-10 grid gap-6 lg:grid-cols-2">
                <div className="border border-gray-700 bg-[#0f172a] p-6 text-gray-200">
                  <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">
                    The old way
                  </p>
                  <h3 className="font-display mt-4 text-2xl font-semibold text-gray-100">YAML. SQL strings.</h3>
                  <ul className="mt-4 space-y-3 text-sm text-gray-300">
                    <li>Query logic scattered across dashboards, scripts, and services.</li>
                    <li>String‑concatenated SQL that drifts as schemas evolve.</li>
                    <li>Metrics definitions duplicated and re‑implemented per team.</li>
                  </ul>
                  <div className="mt-6">
                    <CodeHighlight
                      code={`const result = await client.query({
  query: \`
    SELECT name, email, created_at
    FROM users
    WHERE created_at >= '2024-01-01'
    AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 10
  \`
});

// ❌ No type safety
// ❌ Typos caught at runtime
// ❌ SQL injection risk
// ❌ Can't refactor safely`}
                      language="typescript"
                    />
                  </div>
                </div>
                <div className="border border-indigo-500/40 bg-[#0a0f1d] p-6 text-gray-200">
                  <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
                    The hypequery way
                  </p>
                  <h3 className="font-display mt-4 text-2xl font-semibold text-gray-100">Everything is code.</h3>
                  <ul className="mt-4 space-y-3 text-sm text-gray-300">
                    <li>Type‑safe metrics defined once in TypeScript.</li>
                    <li>Reusable definitions power APIs, jobs, dashboards, and agents.</li>
                    <li>Auth, multi‑tenancy, and caching stay consistent everywhere.</li>
                  </ul>
                  <div className="mt-6">
                    <CodeHighlight
                      code={`const result = await db
  .table('users')
  .select(['name', 'email', 'created_at'])
  .where('created_at', 'gte', '2024-01-01')
  .where('status', 'eq', 'active')
  .orderBy('created_at', 'DESC')
  .limit(10)
  .execute();

// ✅ Full type safety
// ✅ Compile-time checks
// ✅ Auto-completion
// ✅ Refactor with confidence`}
                      language="typescript"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-14">
                <h3 className="font-display text-2xl font-semibold tracking-tight text-gray-100">
                  See it in action
                </h3>
                <p className="mt-3 text-base text-gray-300">
                  Click through these examples to see how hypequery works across different use cases.
                </p>
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-4 lg:grid-cols-4">
                {useCaseExamplesRaw.map((useCase) => (
                  <button
                    key={useCase.id}
                    type="button"
                    onClick={() => setSelectedUseCase(useCase)}
                    className={`border p-6 text-left shadow-sm transition ${selectedUseCase.id === useCase.id
                      ? 'border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-500/50'
                      : 'border-gray-200 bg-white hover:border-indigo-300 dark:bg-gray-800 dark:border-gray-700'
                      }`}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {useCase.title}
                    </h3>
                    <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">
                      {useCase.summary}
                    </p>
                  </button>
                ))}
              </div>
              <div className="mt-10">
                <div className="bg-white p-6 text-gray-900 shadow-lg ring-2 ring-indigo-100 dark:bg-gray-800 dark:text-gray-100">
                  <h3 className="font-display mt-3 text-2xl font-bold tracking-tight">
                    {selectedUseCase.title}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-gray-600 dark:text-gray-300">
                    {selectedUseCase.body}
                  </p>
                  <div className="mt-6">
                    <div className="border border-indigo-500/25 bg-gray-950">
                      <div className="flex gap-2 p-4">
                        <div className="w-3 h-3 bg-white/18"></div>
                        <div className="w-3 h-3 bg-white/18"></div>
                        <div className="w-3 h-3 bg-white/18"></div>
                      </div>
                      <div className="px-4 pb-4">
                        <CodeHighlight
                          code={selectedUseCase.code}
                          language={selectedUseCase.codeLanguage}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Why your org keeps rebuilding this layer */}
            <section className="mt-20">
              <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 bg-gray-100 py-16 dark:bg-gray-800">
                <div className="mx-auto max-w-7xl px-4 lg:px-6">
                  <div className="grid gap-10 lg:grid-cols-[1.1fr_auto] lg:items-center">
                    <div>
                      <h2 className="font-display text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                        Why orgs keep rebuilding this layer
                      </h2>
                      <p className="mt-6 text-lg leading-7 text-gray-700 dark:text-gray-300">
                        ClickHouse teams that centralize semantics with hypequery stop
                        firefighting mismatched dashboards because every consumer reuses the same
                        governed module, so velocity goes into shipping metrics instead of
                        reconciling them.
                      </p>
                      <div className="mt-8 grid gap-6 md:grid-cols-2">
                        <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-900/40 dark:border-gray-700">
                          <p className="font-display text-base font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">
                            Without hypequery
                          </p>
                          <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-gray-700 dark:text-gray-300">
                            <li>APIs, dashboards, and bots each reinvent metric logic.</li>
                            <li>Tenant filters and auth patches drift per team.</li>
                            <li>Analytics changes go through Slack debates, not code review.</li>
                          </ul>
                        </div>
                        <div className="border border-indigo-200 bg-white p-6 shadow-sm ring-1 ring-indigo-100 dark:bg-gray-900/60 dark:border-indigo-500/40">
                          <p className="font-display text-base font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
                            With hypequery
                          </p>
                          <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-gray-700 dark:text-gray-200">
                            <li>One TypeScript definition per metric, versioned and tested.</li>
                            <li>Governed runtime injects auth, tenancy, caching everywhere.</li>
                            <li>APIs, jobs, dashboards, and agents call the exact same endpoint.</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <Image
                        src="/confused_mascot.png"
                        alt="Confused mascot wondering about SQL"
                        width={288}
                        height={288}
                        className="h-72 w-auto object-contain"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* An end-to-end platform for analytics development */}
            <section className="pt-20 pb-20">
              <h2 className="font-display text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                An end-to-end platform for analytics development
              </h2>
              <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Catch breaking schema changes before deploy
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Your ClickHouse schema becomes a TypeScript SDK. Columns become types, tables
                    become interfaces, so CI tells you when analytics logic drifts.
                  </p>
                </div>
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Run governed metrics everywhere, not just HTTP
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Jobs, APIs, scripts, or agents import the exact same definition. HTTP is
                    optional, your metrics travel to whatever surface needs them.
                  </p>
                </div>
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Metrics as first-class code citizens
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Import definitions like any other module. The same query powers your API,
                    dashboard, cron job, and agent without reimplementation.
                  </p>
                </div>
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Ship APIs with OpenAPI and authentication out of the box
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Every query becomes an HTTP endpoint complete with validation and typed SDKs.
                    No controllers, routing glue, or YAML hand wiring.
                  </p>
                </div>
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Bake tenant isolation into the platform
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Declare tenant patterns once. The runtime auto-injects filters, validates
                    auth, and guarantees isolation—making cross-tenant leaks impossible.
                  </p>
                </div>
                <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Ship-ready authentication, caching, and observability primitives
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Verify sessions, inject user context, control access, and cache at the query
                    level. You focus on metrics, the platform handles safety and insight.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </div >

        {/* Final CTA section */}
        < section className="my-14 relative isolate overflow-hidden bg-white px-6 py-14 text-center sm:px-12 lg:px-16 dark:bg-gray-900" >
          <div className="mx-auto max-w-3xl text-gray-900 dark:text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-white/70">
              Ship faster
            </p>
            <h2 className="font-display mt-4 text-3xl font-bold sm:text-4xl">
              Build your first type-safe query in 30 seconds
            </h2>
            <p className="mt-4 text-base text-gray-600 sm:text-lg dark:text-white/80">
              Get started with the query builder, then add HTTP APIs and team features when you need them.
              Teams use it to keep product analytics, finance APIs, and AI agents perfectly in sync.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/docs/quick-start-builder"
                className="inline-flex items-center justify-center bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-indigo-500"
              >
                Get started →
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
              >
                Explore docs
              </Link>
            </div>
            <p className="mt-6 text-gray-600 dark:text-gray-400 font-medium">
              Early adopter? DM us{' '}
              <a
                href="https://twitter.com/hypequery"
                className="text-indigo-600 hover:text-indigo-700 font-medium dark:text-indigo-400 dark:hover:text-indigo-300"
                target="_blank"
                rel="noopener noreferrer"
              >
                @hypequery
              </a>
              {' '}
              — let's build this together.
            </p>
          </div>
        </section >
      </main >
      <Footer />
    </>
  );
}
