'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { trackUmamiEvent } from '@/lib/umami';
import { HERO_SNIPPETS, HERO_TABS } from './constants';
import { InstallCommand } from './InstallCommand';

export function Hero() {
  const [aiContextCopied, setAiContextCopied] = useState(false);

  const handleCopyAiContext = () => {
    navigator.clipboard.writeText(''); // Blank for now
    setAiContextCopied(true);
    setTimeout(() => setAiContextCopied(false), 2000);
  };

  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[140px] pb-16 flex flex-col items-center text-center">
      <h1 className="text-display text-text max-w-[1000px] text-balance">
        Ship type-safe analytics on <em className="not-italic text-accent">ClickHouse.</em>
      </h1>

      <p className="mt-[22px] text-body-lg text-text-muted max-w-[660px] text-pretty">
        Define queries, metrics, and dimensions inside the backend you already have. Expose them as typed APIs, React hooks, or MCP tools for your AI agents.
      </p>

      <div className="flex gap-2.5 mt-7 flex-wrap justify-center">
        <Link
          href="/docs/quick-start"
          onClick={() => trackUmamiEvent('cta_click', { target: 'docs_quick_start', location: 'hero', page: '/' })}
          className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
        >
          Get started in 30s →
        </Link>
        <button
          onClick={handleCopyAiContext}
          className="relative inline-flex items-center gap-2 bg-bg-card border border-border-strong text-text px-5 py-3 text-[13.5px] font-semibold rounded transition hover:border-text hover:-translate-y-px"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy AI Context
          {aiContextCopied && (
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-text text-bg text-xs font-sans font-medium rounded whitespace-nowrap">
              Copied!
            </span>
          )}
        </button>
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

      <InstallCommand className="mt-8" />

    </section>
  );
}
