'use client';

import { useEffect, useState } from 'react';

const TERMINAL_LINES = [
  { text: '✓ Reading datasets        orders', tone: 'muted' },
  { text: '✓ Publishing              1 dataset', tone: 'muted' },
  { text: '✓ Types generated         @hypequery/client', tone: 'accent' },
  { text: '→ Live at acme.hypequery.cloud', tone: 'text' },
  { text: '  Fully typed, end to end.', tone: 'accent' },
] as const;

function DeployTerminal() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setVisibleLines((current) => (current >= TERMINAL_LINES.length ? 0 : current + 1));
    }, 1500);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      className="flex h-full min-h-[360px] max-w-full flex-col overflow-hidden rounded-lg border border-border-strong bg-[#0f1117] font-mono text-[12.5px] leading-6 text-white shadow-card"
      aria-label="Animated hypequery deploy terminal"
    >
      <div className="flex h-8 items-center gap-2 border-b border-white/[0.08] bg-white/[0.03] px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
      </div>
      <div className="flex flex-1 flex-col px-5 py-5">
        <div className="flex items-center gap-2 text-white">
          <span className="text-accent">$</span>
          <span>hypequery deploy</span>
          <span className="inline-block h-4 w-2 animate-pulse bg-accent/20" />
        </div>
        <div className="mt-5 flex-1">
          {TERMINAL_LINES.map((line, index) => (
            <div
              key={line.text}
              className={`transition-all duration-300 ${index < visibleLines ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                } ${line.tone === 'accent'
                  ? 'text-white'
                  : line.tone === 'muted'
                    ? 'text-white/58'
                    : 'text-white'
                }`}
            >
              {line.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Cloud() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px]">
      <div className="rounded-lg border border-border-strong bg-bg-card px-6 py-7 shadow-card md:px-8 md:py-8 ">
        <div className="grid gap-7 lg:grid-cols-[1fr_420px] lg:items-stretch">
          <div>
            <p className="font-mono text-eyebrow text-accent mb-3.5">Cloud. Coming soon</p>
            <h2 className="text-h2 text-text max-w-[680px] text-balance">Your queries and datasets, deployed.</h2>
            <p className="mt-3.5 text-body text-text-muted max-w-[640px] text-pretty">
              One command takes everything you&apos;ve defined and serves it from the cloud. Managed, hosted, no infrastructure to run.
            </p>
            <form
              action="https://formspree.io/f/mzdwnylk"
              method="POST"
              className="rounded-lg border border-border bg-bg-alt p-4 mt-4"
            >
              <label htmlFor="cloud-email" className="block font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-dim">
                Notify me
              </label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col">
                <input
                  id="cloud-email"
                  type="email"
                  name="email"
                  required
                  placeholder="you@company.com"
                  className="min-h-11 flex-1 rounded border border-border-strong bg-bg-card px-3 text-[14px] text-text outline-none transition placeholder:text-text-dim focus:border-accent"
                />
                <input type="hidden" name="source" value="homepage-cloud-band" />
                <button
                  type="submit"
                  className="min-h-11 rounded border border-border-strong px-4 text-[13px] font-semibold text-text transition hover:border-text hover:bg-bg-card"
                >
                  Notify me →
                </button>
              </div>
            </form>
          </div>
          <DeployTerminal />
        </div>
      </div>
    </section>
  );
}
