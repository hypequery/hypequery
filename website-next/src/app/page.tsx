'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Footer from '@/components/Footer';
import CodeHighlight from '@/components/CodeHighlight';
import { heroCode, runAnywhereSnippets, useCaseExamples as useCaseExamplesRaw } from '@/data/homepage-content';

export default function Home() {
  const [selectedUseCase, setSelectedUseCase] = useState(useCaseExamplesRaw[0]);

  return (
    <>
      <main>
        {/* Hero section */}
        <div className="relative isolate bg-[#0b1120] pt-20 pb-16 text-gray-100">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold uppercase tracking-[0.2em] text-gray-300/80">
              <Link href="/docs" className="hover:text-gray-100 transition-colors">
                Docs
              </Link>
              <Link href="/docs/quick-start" className="hover:text-gray-100 transition-colors">
                Quick Start
              </Link>
              <Link href="/blog" className="hover:text-gray-100 transition-colors">
                Resources
              </Link>
              <a
                href="https://github.com/hypequery/hypequery"
                className="hover:text-gray-100 transition-colors"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
              <Link href="/docs" className="hover:text-gray-100 transition-colors">
                Support
              </Link>
            </div>

            <div className="mt-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 60 960 160"
                preserveAspectRatio="xMidYMid meet"
                className="w-full h-auto opacity-95"
                role="img"
                aria-label="Hypequery"
              >
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(1.448986, 195.88052)">
                    <g>
                      <path d="M 101.082031 0 L 101.082031 -127.933594 L 69.050781 -127.933594 L 69.050781 -78.449219 L 37.019531 -78.449219 L 37.019531 -127.933594 L 4.988281 -127.933594 L 4.988281 0 L 37.019531 0 L 37.019531 -50.253906 L 69.050781 -50.253906 L 69.050781 0 Z M 101.082031 0 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(107.512939, 195.88052)">
                    <g>
                      <path d="M 105.109375 -98.589844 L 105.109375 -127.933594 L 66.75 -127.933594 L 66.75 -78.640625 L 41.238281 -78.640625 L 41.238281 -127.933594 L 2.878906 -127.933594 L 2.878906 -98.589844 L 9.207031 -98.589844 L 9.207031 -50.445312 L 37.976562 -50.445312 L 37.976562 0 L 70.007812 0 L 70.007812 -50.445312 L 98.78125 -50.445312 L 98.78125 -98.589844 Z M 105.109375 -98.589844 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(215.494865, 195.88052)">
                    <g>
                      <path d="M 101.082031 -35.675781 L 101.082031 -127.933594 L 4.988281 -127.933594 L 4.988281 0 L 37.019531 0 L 37.019531 -35.675781 Z M 69.050781 -64.832031 L 37.019531 -64.832031 L 37.019531 -98.589844 L 69.050781 -98.589844 Z M 69.050781 -64.832031 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(320.983416, 195.88052)">
                    <g>
                      <path d="M 100.699219 0 L 100.699219 -29.15625 L 37.019531 -29.15625 L 37.019531 -50.253906 L 100.699219 -50.253906 L 100.699219 -78.449219 L 37.019531 -78.449219 L 37.019531 -98.589844 L 100.699219 -98.589844 L 100.699219 -127.933594 L 4.988281 -127.933594 L 4.988281 0 Z M 100.699219 0 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(426.663768, 195.88052)">
                    <g>
                      <path d="M 101.082031 0 L 101.082031 -127.933594 L 4.988281 -127.933594 L 4.988281 0 L 37.019531 0 L 37.019531 21.289062 L 69.050781 21.289062 L 69.050781 0 Z M 69.050781 -29.15625 L 37.019531 -29.15625 L 37.019531 -98.589844 L 69.050781 -98.589844 Z M 69.050781 -29.15625 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(532.727692, 195.88052)">
                    <g>
                      <path d="M 101.082031 0 L 101.082031 -127.933594 L 69.050781 -127.933594 L 69.050781 -29.15625 L 37.019531 -29.15625 L 37.019531 -127.933594 L 4.988281 -127.933594 L 4.988281 0 Z M 101.082031 0 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(638.791673, 195.88052)">
                    <g>
                      <path d="M 100.699219 0 L 100.699219 -29.15625 L 37.019531 -29.15625 L 37.019531 -50.253906 L 100.699219 -50.253906 L 100.699219 -78.449219 L 37.019531 -78.449219 L 37.019531 -98.589844 L 100.699219 -98.589844 L 100.699219 -127.933594 L 4.988281 -127.933594 L 4.988281 0 Z M 100.699219 0 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(744.471996, 195.88052)">
                    <g>
                      <path d="M 101.082031 0 L 82.285156 -35.675781 L 101.082031 -35.675781 L 101.082031 -127.933594 L 4.988281 -127.933594 L 4.988281 0 L 37.019531 0 L 37.019531 -35.675781 L 50.828125 -35.675781 L 69.050781 0 Z M 69.050781 -64.832031 L 37.019531 -64.832031 L 37.019531 -98.589844 L 69.050781 -98.589844 Z M 69.050781 -64.832031 " />
                    </g>
                  </g>
                </g>
                <g fill="#ffffff" fillOpacity="1">
                  <g transform="translate(850.535977, 195.88052)">
                    <g>
                      <path d="M 105.109375 -98.589844 L 105.109375 -127.933594 L 66.75 -127.933594 L 66.75 -78.640625 L 41.238281 -78.640625 L 41.238281 -127.933594 L 2.878906 -127.933594 L 2.878906 -98.589844 L 9.207031 -98.589844 L 9.207031 -50.445312 L 37.976562 -50.445312 L 37.976562 0 L 70.007812 0 L 70.007812 -50.445312 L 98.78125 -50.445312 L 98.78125 -98.589844 Z M 105.109375 -98.589844 " />
                    </g>
                  </g>
                </g>
              </svg>
            </div>

            <div className="mt-10 max-w-2xl">
              <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-gray-100/90">
                The fastest way to ship analytics across your entire stack
              </h1>
              <p className="mt-4 text-base md:text-lg leading-7 text-gray-300">
                Define metrics once in TypeScript. Reuse across APIs, jobs, dashboards, and AI agents.
                Authentication and multi-tenancy baked in.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  href="/docs/quick-start"
                  className="rounded-full bg-indigo-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-white shadow-sm transition hover:bg-indigo-500"
                >
                  Try for Free
                </Link>
                <Link
                  href="/docs"
                  className="rounded-full border border-gray-600 px-6 py-3 text-sm font-semibold uppercase tracking-wide text-gray-100 transition hover:bg-white/10"
                >
                  Talk to an Engineer
                </Link>
              </div>
              <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
                No credit card required
              </p>
            </div>

            {/* Architecture explainer */}
            {/* <HypequeryArchitecture /> */}
          </div>
        </div>

        <div className="bg-[#0b1120]">
          <div className="mx-auto max-w-7xl px-4 lg:px-6">
            {/* Everything is code section */}
            <section className="mt-12 rounded-2xl py-8 text-gray-900 dark:text-gray-100">
              <p className="text-sm font-semibold uppercase tracking-wide text-indigo-500">
                Everything is code
              </p>
              <h2 className="mt-2 text-3xl font-bold tracking-tight">
                From schema to serving: analytics as a proper development platform
              </h2>
              <div className="mt-6 space-y-4 text-base leading-7 text-gray-600 dark:text-gray-300">
                <p>
                  Schema introspection → type generation → query definitions → HTTP APIs. All
                  wired together with end-to-end type safety. No config files, no string
                  interpolation, no runtime surprises. Just code that scales with your team.
                </p>
              </div>
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-indigo-500/25 bg-gray-950 shadow-2xl">
                  <div className="flex gap-2 p-4">
                    <div className="w-3 h-3 rounded-full bg-white/18"></div>
                    <div className="w-3 h-3 rounded-full bg-white/18"></div>
                    <div className="w-3 h-3 rounded-full bg-white/18"></div>
                  </div>
                  <div>
                    <CodeHighlight code={heroCode} language="ts" />
                  </div>
                </div>
                <div className="rounded-xl p-1 text-sm space-y-8">
                  <div className="text-lg font-bold uppercase tracking-wide">
                    Define Once. Run anywhere.
                  </div>
                  <div>
                    <p className="mb-4 font-semibold text-md">Embedded</p>
                    <CodeHighlight code={runAnywhereSnippets.embedded.code} language="ts" />
                  </div>
                  <div>
                    <p className="mb-4 font-semibold text-md">API</p>
                    <CodeHighlight code={runAnywhereSnippets.api.code} language="http" />
                  </div>
                  <div>
                    <p className="mb-4 font-semibold text-md">React</p>
                    <CodeHighlight code={runAnywhereSnippets.react.code} language="ts" />
                  </div>
                  <div>
                    <p className="mb-4 font-semibold text-md">AI agent</p>
                    <CodeHighlight code={runAnywhereSnippets.agent.code} language="json" />
                  </div>
                </div>
              </div>
            </section>

            {/* The single source of truth for your data */}
            <section className="mt-24">
              <h2 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
                The single source of truth for your data
              </h2>
              <p className="mt-3 text-base text-gray-500 dark:text-gray-300">
                Pick the workflow you're fighting today—every card is powered by the exact same
                metric definitions.
              </p>
              <div className="mt-10 grid gap-4 md:grid-cols-4 lg:grid-cols-4">
                {useCaseExamplesRaw.map((useCase) => (
                  <button
                    key={useCase.id}
                    type="button"
                    onClick={() => setSelectedUseCase(useCase)}
                    className={`border rounded-2xl p-6 text-left shadow-sm transition ${selectedUseCase.id === useCase.id
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
                <div className="rounded-3xl bg-white p-6 text-gray-900 shadow-lg ring-2 ring-indigo-100 dark:bg-gray-800 dark:text-gray-100">
                  <h3 className="mt-3 text-2xl font-bold tracking-tight">
                    {selectedUseCase.title}
                  </h3>
                  <p className="mt-4 text-base leading-7 text-gray-600 dark:text-gray-300">
                    {selectedUseCase.body}
                  </p>
                  <div className="mt-6">
                    <div className="rounded-2xl border border-indigo-500/25 bg-gray-950">
                      <div className="flex gap-2 p-4">
                        <div className="w-3 h-3 rounded-full bg-white/18"></div>
                        <div className="w-3 h-3 rounded-full bg-white/18"></div>
                        <div className="w-3 h-3 rounded-full bg-white/18"></div>
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
                        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-900/40 dark:border-gray-700">
                          <p className="text-base font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-300">
                            Without hypequery
                          </p>
                          <ul className="mt-4 list-disc space-y-3 pl-5 text-base leading-7 text-gray-700 dark:text-gray-300">
                            <li>APIs, dashboards, and bots each reinvent metric logic.</li>
                            <li>Tenant filters and auth patches drift per team.</li>
                            <li>Analytics changes go through Slack debates, not code review.</li>
                          </ul>
                        </div>
                        <div className="rounded-2xl border border-indigo-200 bg-white p-6 shadow-sm ring-1 ring-indigo-100 dark:bg-gray-900/60 dark:border-indigo-500/40">
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
                        className="h-72 w-auto rounded-3xl object-contain"
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
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Catch breaking schema changes before deploy
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Your ClickHouse schema becomes a TypeScript SDK. Columns become types, tables
                    become interfaces, so CI tells you when analytics logic drifts.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Run governed metrics everywhere, not just HTTP
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Jobs, APIs, scripts, or agents import the exact same definition. HTTP is
                    optional, your metrics travel to whatever surface needs them.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Metrics as first-class code citizens
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Import definitions like any other module. The same query powers your API,
                    dashboard, cron job, and agent without reimplementation.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Ship APIs with OpenAPI and authentication out of the box
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Every query becomes an HTTP endpoint complete with validation and typed SDKs.
                    No controllers, routing glue, or YAML hand wiring.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    Bake tenant isolation into the platform
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                    Declare tenant patterns once. The runtime auto-injects filters, validates
                    auth, and guarantees isolation—making cross-tenant leaks impossible.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
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
                className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-indigo-500"
              >
                Get started →
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center justify-center rounded-md border border-slate-200 px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-white/20 dark:text-white dark:hover:bg-white/10"
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
