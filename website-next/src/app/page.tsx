'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeHighlight from '@/components/CodeHighlight';
import { heroCode, runAnywhereSnippets, useCaseExamples as useCaseExamplesRaw } from '@/data/homepage-content';
import { CopyButton } from '@/components/CopyButton';

export default function Home() {
  const [selectedUseCase, setSelectedUseCase] = useState(useCaseExamplesRaw[0]);
  const [terminalText, setTerminalText] = useState('');
  const [showPrompt, setShowPrompt] = useState(true);

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
    'Run: npm run dev'
  ];

  useEffect(() => {
    let lineIndex = 0;
    let charIndex = 0;
    let currentText = '';

    const typeNextChar = () => {
      if (lineIndex < terminalLines.length) {
        const currentLine = terminalLines[lineIndex];

        if (charIndex < currentLine.length) {
          // Still typing the current line
          currentText += currentLine[charIndex];
          charIndex++;
          setTerminalText(currentText);
          setTimeout(typeNextChar, 15 + Math.random() * 30); // Random typing speed
        } else {
          // Line finished, add newline and move to next line
          currentText += '\n';
          lineIndex++;
          charIndex = 0;
          setTerminalText(currentText);
          setTimeout(typeNextChar, 100); // Pause between lines
        }
      }
    };

    const startDelay = setTimeout(() => {
      setShowPrompt(false);
      typeNextChar();
    }, 800);

    return () => clearTimeout(startDelay);
  }, []);

  return (
    <>
      <Navigation />
      <main className="bg-[#0b1120]">
        {/* Hero section */}
        <div className="relative isolate pt-14">
          <div className="pt-24">
            <div className="mx-auto max-w-7xl px-4 lg:px-6">
              <div className="flex flex-col items-start md:flex-row relative">
                <div className="max-w-3xl pb-12 relative z-10">
                  <div className="inline-flex items-center mb-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-200">
                    The Analytics Backend for ClickHouse Teams
                  </div>
                  <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl dark:text-gray-100">
                    Ship analytics across your entire stack
                  </h1>
                  <div>
                    <p className="mt-4 text-lg leading-8 text-gray-600 dark:text-gray-300">
                      Define metrics once in TypeScript. Reuse across APIs, jobs,
                      dashboards, and AI agents. Authentication and multi-tenancy baked in.
                    </p>
                    <p className="mt-2 text-lg leading-8 text-gray-600 dark:text-gray-300 font-medium">
                      One definition. Any context. Zero drift.
                    </p>
                  </div>
                  <div className="mt-8 space-y-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <Link
                        href="/docs/quick-start"
                        className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
                      >
                        Start in 2 Minutes →
                      </Link>
                      <a
                        href="https://github.com/hypequery/hypequery"
                        className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-white/10"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"></path>
                        </svg>
                        on GitHub
                      </a>
                    </div>
                  </div>
                  <p className="mt-3 text-sm font-medium uppercase tracking-wide text-gray-500">
                    No YAML · No string-concatenated SQL · No duplicated metrics
                  </p>
                </div>

                {/* Hero mascot and terminal - only show on large screens */}
                <div className="block hidden:md hero-mascot-wrapper">
                  <div className="absolute right-95 top-45">
                    <Image
                      src="/mascot_dark.jpeg"
                      alt="hypequery mascot"
                      width={256}
                      height={256}
                      className="hero-mascot-dark h-64 w-auto rounded-2xl object-contain block"
                    />
                  </div>
                  <div className="absolute right-0 top-10 -translate-y-1/4">
                    <div className="relative w-[410px] min-h-[250px] rounded-2xl border border-gray-800 bg-gray-950 px-5 py-4 text-sm text-green-300 shadow-2xl">
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
                    Schema introspection → type generation → query
                    definitions → HTTP APIs. All wired together with end-to-end
                    type safety. No config files, no string interpolation, no
                    runtime surprises. Just code that scales with your team.
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
                <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
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
                          <CodeHighlight code={selectedUseCase.code} language={selectedUseCase.codeLanguage} />
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
                          Why orgs keeps rebuilding this layer
                        </h2>
                        <p className="mt-6 text-lg leading-7 text-gray-700 dark:text-gray-300">
                          Every scaled ClickHouse team eventually builds the same
                          thing: a type-safe semantic layer that hides schema
                          complexity and exposes governed, reusable metrics. You
                          just get to start there.
                        </p>
                        <div className="mt-6 space-y-3 text-base leading-7 text-gray-700 dark:text-gray-300">
                          <p>Your API reports $1.2M in revenue.</p>
                          <p>The dashboard shows $1.3M.</p>
                          <p>The Slack bot says $1.1M.</p>
                        </div>
                        <div className="mt-6 space-y-3 text-base leading-7 text-gray-700 dark:text-gray-300">
                          <p>Someone tweaked a date filter.</p>
                          <p>Someone else "fixed" the exclusion logic.</p>
                          <p>An agent hallucinated a JOIN.</p>
                        </div>
                        <div className="mt-6 space-y-3 text-base leading-7 text-gray-700 dark:text-gray-300">
                          <p>
                            Suddenly "what's our revenue?" needs a Slack thread, a
                            meeting, and three engineers debating whose SQL is
                            right.
                          </p>
                          <p>
                            This is what happens when analytics doesn't have a
                            platform.
                          </p>
                          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                            One definition. Every consumer. Zero ambiguity.
                          </p>
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
                      Schema-aware, type-safe foundation
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Your ClickHouse schema becomes a TypeScript SDK. Columns
                      become types, tables become interfaces. Refactor with
                      confidence, catch errors at build time.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Execute anywhere, not just via HTTP
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Run queries directly in jobs, APIs, scripts, or agents. HTTP
                      is optional, not required. Your metrics travel to where
                      they're needed.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Metrics as first-class code citizens
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Import definitions like any other module. Same query in your
                      API, dashboard, cron job, and AI agent. One source of truth.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Auto-generated APIs with zero boilerplate
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Every query becomes an HTTP endpoint with OpenAPI, input
                      validation, and TypeScript clients. No controllers, no routing
                      code, no YAML.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Tenant isolation at the platform level
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Declare tenant patterns once. The platform auto-injects
                      filters, validates auth, and guarantees isolation. Impossible
                      to leak data between tenants.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:bg-gray-800 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                      Auth, observability & caching built in
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
                      Verify sessions, inject user context, control access, and
                      cache at the query level. Security primitives and
                      observability included, not bolted on.
                    </p>
                  </div>
                </div>
              </section>
            </div>
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
              Point hypequery at your ClickHouse cluster and get the full stack:
              schema-aware SDK, type-safe metrics, HTTP APIs, and observability.
              Everything wired together with end-to-end type safety.
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
