import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { DATASETS_SECTION_CODE } from './constants';

const STEPS = [
  {
    label: 'Name',
    text: 'Turn measures into reusable metrics like revenue and order count.',
  },
  {
    label: 'Compose',
    text: 'Build derived metrics from the same dataset with formula helpers.',
  },
  {
    label: 'Query',
    text: 'Run the same metric from server code, jobs, APIs, React hooks, or agents.',
  },
  {
    label: 'Inspect',
    text: 'Call toSQL when you want to see the exact ClickHouse query.',
  },
];

export function Datasets() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div>
          <p className="font-mono text-eyebrow text-accent mb-3.5">Datasets · semantic layer in code</p>
          <h2 className="text-h2 text-text max-w-[680px] text-balance">
            Define metrics once. Compose the ones that matter.
          </h2>
          <p className="mt-4 text-body text-text-muted max-w-[640px] text-pretty">
            Datasets model your ClickHouse table, then let you name reusable metrics and compose derived metrics in TypeScript. That is the semantic layer: revenue, order count, and average order value live in one definition and travel through APIs, jobs, React hooks, dashboards, and agents.
          </p>

          <div className="mt-8 grid gap-3">
            {STEPS.map((step) => (
              <div key={step.label} className="rounded-lg border border-border bg-bg-card p-4">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
                  {step.label}
                </div>
                <p className="mt-1.5 text-body-sm text-text-muted">{step.text}</p>
              </div>
            ))}
          </div>

          <Link
            href="/docs/datasets/overview"
            className="mt-7 inline-flex items-center gap-1.5 bg-text text-bg px-4 py-2 text-[13px] font-semibold rounded transition hover:opacity-90"
          >
            Read the datasets docs →
          </Link>
        </div>

        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="font-mono text-[11px] font-semibold tracking-[0.16em] uppercase text-text-muted">
              datasets/orders.ts
            </span>
            <span className="font-mono text-[11px] text-accent">same dataset · derived metric</span>
          </div>
          <div className="bg-bg-alt p-5">
            <CodeHighlight
              code={DATASETS_SECTION_CODE}
              language="typescript"
              className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
