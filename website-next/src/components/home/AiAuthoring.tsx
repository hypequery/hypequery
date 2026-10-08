import Link from 'next/link';
import { Check, Sparkles } from 'lucide-react';
import { DeployWaitlist } from './DeployWaitlist';

const STEPS = [
  ['Connect ClickHouse', 'Point Cloud at your database with a read-only user.'],
  ['AI learns your business', 'It reads your schema and asks what matters: revenue, customers, tenants.'],
  ['Review and go live', 'Accept the proposed datasets, and they are served as REST and MCP endpoints.'],
] as const;

const PROPOSALS = [
  ['revenue', 'measure', 'sum(amount)'],
  ['order_count', 'measure', 'count(id)'],
  ['country', 'dimension', 'string'],
  ['tenant key', 'rule', 'tenant_id'],
] as const;

export function AiAuthoring() {
  return (
    <section aria-labelledby="ai-authoring-title" className="mx-auto max-w-[1280px] px-5 pb-4 pt-12 sm:px-8 sm:pt-16">
      <div className="grid items-center gap-10 md:grid-cols-2">
        <div>
          <h2 id="ai-authoring-title" className="home-section-title text-text">Describe your business. Get a semantic layer.</h2>
          <p className="mt-4 max-w-[520px] text-sm leading-6 text-text-muted sm:text-base">
            Cloud&apos;s AI drafts your datasets for you, so you go from a ClickHouse connection to governed AI answers in
            minutes.
          </p>
          <ol className="mt-8 space-y-5">
            {STEPS.map(([title, copy], index) => (
              <li key={title} className="flex gap-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong font-mono text-[11px] text-text-muted">{index + 1}</span>
                <span>
                  <span className="block text-sm font-medium text-text">{title}</span>
                  <span className="mt-1 block text-sm leading-6 text-text-muted">{copy}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <DeployWaitlist location="ai-authoring" className="inline-flex min-h-11 items-center gap-3 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 dark:text-[#0c0e14]" />
            <Link href="/docs/datasets/defining-datasets" className="text-sm text-text-muted transition hover:text-accent">
              Prefer code? Define datasets in TypeScript or Python.
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card" role="img" aria-label="Illustrative AI-proposed dataset for an orders table, with each measure, dimension, and tenant rule accepted">
          <div className="flex items-center gap-2 text-xs font-medium text-text">
            <Sparkles className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Proposed dataset: <span className="font-mono">orders</span>
            <span className="ml-auto text-[10px] font-normal text-text-dim">Draft</span>
          </div>
          <ul className="mt-4 divide-y divide-border">
            {PROPOSALS.map(([name, kind, detail]) => (
              <li key={name} className="flex items-center gap-3 py-3 text-xs">
                <span className="font-mono text-text">{name}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-muted">{kind}</span>
                <span className="font-mono text-text-dim">{detail}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent"><Check className="h-3 w-3" aria-hidden="true" />Accepted</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-[11px] text-accent">
            Live as REST and MCP endpoints
          </div>
        </div>
      </div>
    </section>
  );
}
