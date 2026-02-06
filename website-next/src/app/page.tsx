'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import HeroLinks from '@/components/HeroLinks';
import HeroLogo from '@/components/HeroLogo';
import Footer from '@/components/Footer';
import CodeHighlight from '@/components/CodeHighlight';
import { heroCode, useCaseExamples as useCaseExamplesRaw } from '@/data/homepage-content';
import { CopyButton } from '@/components/CopyButton';

export default function Home() {
  const [selectedUseCase, setSelectedUseCase] = useState(useCaseExamplesRaw[0]);

  return (
    <>
      <main>
        {/* Hero section */}
        <div className="relative isolate bg-[#0b1120] pb-30 text-gray-100">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <div className="sticky top-0 z-40 lg:-mx-6 lg:px-6 bg-[#0b1120]/90 backdrop-blur">
              <div className="py-8 flex justify-end">
                <HeroLinks />
              </div>
            </div>

            <div>
              <HeroLogo className="pl-60 w-full h-auto opacity-95" />
            </div>

            <div className=" flex flex-col justify-between gap-10 lg:flex-row lg:items-start">
              <div className="flex items-end mt-14">
                <Image
                  src="/mascot_dark.jpeg"
                  alt="hypequery mascot"
                  width={320}
                  height={320}
                  className="w-auto"
                />
              </div>
              <div className="mt-8 max-w-2xl lg:order-2 lg:flex-1">
                <h1 className="font-mono text-3xl font-semibold tracking-tight text-gray-100/95">
                  From ClickHouse schema to APIs in minutes
                </h1>
                <p className="mt-4 text-lg leading-7 text-gray-300">
                  Define metrics once in TypeScript and execute them anywhere.
                </p>
              <div className="mt-5 max-w-[400px] border border-gray-800 bg-[#0a0f1d] px-4 py-3 text-sm text-gray-200 shadow-lg">
                  <div className="flex items-center justify-between gap-3 font-mono leading-6">
                    <span className="text-emerald-300">$ npx hypequery init</span>
                    <CopyButton text="npx hypequery init" className="min-w-[96px] px-2 py-1" />
                  </div>
                </div>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <Link
                    href="/docs/quick-start"
                  className="bg-indigo-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-indigo-500 font-mono"
                  >
                    Start in 2 Minutes
                  </Link>
                  <a
                    href="https://github.com/hypequery/hypequery"
                  className="border border-gray-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-gray-100 transition hover:bg-white/10 font-mono"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Star on GitHub
                  </a>
                </div>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                  Drop in authentication · Multi-tenancy ready · Built in caching
                </p>
              </div>
            </div>

            {/* Architecture explainer */}
            {/* <HypequeryArchitecture /> */}
          </div>
        </div>

        <div className="bg-[#1f2937]">
          <div className="mx-auto max-w-7xl px-4 lg:px-6 text-gray-100">
            {/* Everything is code section */}
            <section className="py-16">
              <div className="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-start">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-400">
                    Define once. Execute everywhere.
                  </p>
                  <h2 className="mt-4 font-display text-3xl md:text-4xl font-semibold tracking-tight text-gray-100">
                    The same TypeScript definition powers every surface
                  </h2>
                  <p className="mt-4 text-base md:text-lg leading-7 text-gray-300">
                    Schema introspection → type generation → query definitions → HTTP APIs. All wired
                    together with end-to-end type safety.
                  </p>
                  <div className="mt-8 space-y-8 text-sm md:text-base text-gray-300">
                    <div className="flex gap-4">
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">01</span>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-100">Define once</h3>
                        <p className="mt-2 text-gray-300">
                          Write a query in TypeScript with typed inputs and outputs.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">02</span>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-100">Expose anywhere</h3>
                        <p className="mt-2 text-gray-300">
                          Serve it as HTTP, call it in jobs, or embed it in your app.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-500">03</span>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-100">Governed by default</h3>
                        <p className="mt-2 text-gray-300">
                          Auth, multi-tenancy, and caching stay consistent everywhere.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border border-gray-800 bg-[#0a0f1d] p-6 shadow-xl">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 bg-gray-600"></div>
                    <div className="h-3 w-3 bg-gray-600"></div>
                    <div className="h-3 w-3 bg-gray-600"></div>
                  </div>
                  <div className="mt-4">
                    <CodeHighlight code={heroCode} language="ts" />
                  </div>
                </div>
              </div>
              <div className="mt-8">
                <div className="mt-6 feature-grid overflow-hidden border border-gray-700">
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      AI Agent
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">
                      Callable by AI agent
                    </p>
                    <p className="mt-3 text-sm text-gray-300">
                      Give agents governed, typed access to metrics without raw SQL.
                    </p>
                    <div className="mt-5 h-28 border border-dashed border-gray-600/70"></div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      HTTP
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Expose via HTTP</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Auto-generated endpoints with auth and OpenAPI baked in.
                    </p>
                    <div className="mt-5 h-28 border border-dashed border-gray-600/70"></div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      React
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Consume in React</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Typed hooks and SDKs keep UI and metrics in sync.
                    </p>
                    <div className="mt-5 h-28 border border-dashed border-gray-600/70"></div>
                  </div>
                  <div className="feature-card p-6 text-gray-200">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">
                      In-Process
                    </h3>
                    <p className="mt-3 text-base font-semibold text-gray-100">Run in process</p>
                    <p className="mt-3 text-sm text-gray-300">
                      Call metrics directly inside jobs, scripts, or services.
                    </p>
                    <div className="mt-5 h-28 border border-dashed border-gray-600/70"></div>
                  </div>
                </div>
              </div>
            </section>

            {/* The cost of raw SQL */}
            <section className="mt-24" id="solutions">
              <h2 className="text-3xl font-bold tracking-tight text-gray-100">
                Raw SQL breaks teams at scale
              </h2>
              <p className="mt-3 text-base text-gray-300">
                When every dashboard, service, and script ships its own SQL, metrics drift and trust
                disappears. The same definition should power every surface.
              </p>
              <div className="mt-10 grid gap-6 lg:grid-cols-2">
                <div className="border border-gray-700 bg-[#0f172a] p-6 text-gray-200">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-400">
                    The old way
                  </p>
                  <h3 className="mt-4 text-2xl font-semibold text-gray-100">No YAML. No SQL strings.</h3>
                  <ul className="mt-4 space-y-3 text-sm text-gray-300">
                    <li>Query logic scattered across dashboards, scripts, and services.</li>
                    <li>String‑concatenated SQL that drifts as schemas evolve.</li>
                    <li>Metrics definitions duplicated and re‑implemented per team.</li>
                  </ul>
                </div>
                <div className="border border-indigo-500/40 bg-[#0a0f1d] p-6 text-gray-200">
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-400">
                    The hypequery way
                  </p>
                  <h3 className="mt-4 text-2xl font-semibold text-gray-100">Everything is code.</h3>
                  <ul className="mt-4 space-y-3 text-sm text-gray-300">
                    <li>Type‑safe metrics defined once in TypeScript.</li>
                    <li>Reusable definitions power APIs, jobs, dashboards, and agents.</li>
                    <li>Auth, multi‑tenancy, and caching stay consistent everywhere.</li>
                  </ul>
                </div>
              </div>

              <div className="mt-14 border border-gray-700 bg-[#0f172a] p-6 text-gray-200">
                <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-400">
                  You're in good company
                </p>
                <h3 className="mt-4 text-2xl font-semibold text-gray-100">
                  Hypequery is the abstraction layer every scaled ClickHouse team builds
                </h3>
                <p className="mt-3 text-sm text-gray-300">
                  Uber, Cloudflare, Instacart, GitLab, Lyft, Microsoft, and Contentsquare all built
                  the same stack to make fast ClickHouse schemas usable across teams. Hypequery
                  ships that stack as a library.
                </p>
                <div className="mt-6 flex flex-wrap gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-300">
                  <span>Uber</span>
                  <span>Cloudflare</span>
                  <span>Instacart</span>
                  <span>GitLab</span>
                  <span>Lyft</span>
                  <span>Microsoft</span>
                  <span>Contentsquare</span>
                </div>
                <div className="mt-8 border border-gray-600 bg-[#0b1220] text-gray-200">
                  <div className="border-b border-gray-600 p-4 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                    Self‑service layer → dashboards, apps, AI agents
                  </div>
                  <div className="border-b border-gray-600 p-4 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                    Semantic layer → type‑safe metric definitions in TypeScript
                  </div>
                  <div className="border-b border-gray-600 p-4 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                    Query translation → compile definitions to ClickHouse SQL
                  </div>
                  <div className="p-4 text-xs font-semibold uppercase tracking-[0.25em] text-gray-400">
                    ClickHouse → optimized schemas and materialized views
                  </div>
                </div>
                <div className="mt-4 grid gap-4 text-sm text-gray-300 sm:grid-cols-2">
                  <div className="border border-gray-700 bg-[#0a0f1d] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                      With hypequery
                    </p>
                    <p className="mt-2">
                      The platform team defines metrics once; every surface consumes the same
                      governed API.
                    </p>
                  </div>
                  <div className="border border-gray-700 bg-[#0a0f1d] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                      Without hypequery
                    </p>
                    <p className="mt-2">
                      Each team rebuilds the stack and re‑implements the same logic repeatedly.
                    </p>
                  </div>
                </div>
                <p className="mt-4 text-xs text-gray-400">
                  The tooling changes, but the layers never do.
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
                  <h3 className="mt-3 text-2xl font-bold tracking-tight">
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
            <section className="mt-24">
              <div className="relative left-1/2 right-1/2 w-screen -translate-x-1/2 bg-gray-100 py-16 dark:bg-gray-800">
                <div className="mx-auto max-w-7xl px-4 lg:px-6">
                  <div className="grid gap-10 lg:grid-cols-[1.1fr_auto] lg:items-center">
                    <div>
                      <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
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
                          <p className="text-base font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">
                            Without hypequery
                          </p>
                          <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-gray-700 dark:text-gray-300">
                            <li>APIs, dashboards, and bots each reinvent metric logic.</li>
                            <li>Tenant filters and auth patches drift per team.</li>
                            <li>Analytics changes go through Slack debates, not code review.</li>
                          </ul>
                        </div>
                          <div className="border border-indigo-200 bg-white p-6 shadow-sm ring-1 ring-indigo-100 dark:bg-gray-900/60 dark:border-indigo-500/40">
                          <p className="text-base font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
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
            <section className="mt-24">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                An end-to-end platform for analytics development
              </h2>
              <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Catch breaking schema changes before deploy
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Your ClickHouse schema becomes a TypeScript SDK. Columns become types, tables
                    become interfaces, so CI tells you when analytics logic drifts.
                  </p>
                </div>
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Run governed metrics everywhere, not just HTTP
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Jobs, APIs, scripts, or agents import the exact same definition. HTTP is
                    optional, your metrics travel to whatever surface needs them.
                  </p>
                </div>
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Metrics as first-class code citizens
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Import definitions like any other module. The same query powers your API,
                    dashboard, cron job, and agent without reimplementation.
                  </p>
                </div>
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Ship APIs with OpenAPI and authentication out of the box
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Every query becomes an HTTP endpoint complete with validation and typed SDKs.
                    No controllers, routing glue, or YAML hand wiring.
                  </p>
                </div>
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Bake tenant isolation into the platform
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Declare tenant patterns once. The runtime auto-injects filters, validates
                    auth, and guarantees isolation—making cross-tenant leaks impossible.
                  </p>
                </div>
                  <div className="border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
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
        </div>

        {/* Final CTA section */}
        <section className="my-16 relative isolate overflow-hidden bg-white px-6 py-16 text-center sm:px-12 lg:px-16 dark:bg-gray-900">
          <div className="mx-auto max-w-3xl text-gray-900 dark:text-white">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-500 dark:text-white/70">
              Ship faster
            </p>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">
              Ready for a proper analytics platform?
            </h2>
            <p className="mt-4 text-base text-gray-600 sm:text-lg dark:text-white/80">
              Point hypequery at your ClickHouse cluster and ship a governed metric in under five minutes.
              Teams use it to keep product analytics, finance APIs, and AI agents perfectly in sync.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/docs/quick-start"
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
        </section>
      </main>
      <Footer />
    </>
  );
}
