import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { DATASET_DEFINITION, DATASET_API_USE, DATASET_JOB_USE, DATASET_DASHBOARD_USE } from './constants';

export function DatasetsDeepDive() {
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
          Built on types generated from your schema, datasets become your semantic layer. Define the table, tenant key, time key, and business logic once. Every semantic query across every consumer uses the same definition.
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
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.85]"
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
                  className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
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
                  className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
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
                className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
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
            Declare <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">tenantKey: 'tenant_id'</code> on the dataset. Semantic dataset and metric execution applies the tenant filter from runtime context automatically.
          </p>
          <p className="mt-3 text-body-sm text-text-muted max-w-[640px]">
            <strong className="text-text font-semibold">No code review checklist.</strong> No manual WHERE clauses in every endpoint. Require tenant context in Serve and requests without it fail before query execution.
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
            <p className="text-body-sm text-text-muted">Every semantic query gets the tenant filter. APIs, jobs, dashboards—automatic.</p>
          </div>
          <div className="p-5 bg-bg-card border border-border rounded-lg">
            <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">3</div>
            <div className="text-[15px] font-bold text-text mb-2">Typed definitions</div>
            <p className="text-body-sm text-text-muted">Misspell a field, filter, or metric and TypeScript catches it before deploy.</p>
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
          href="/docs/datasets/overview"
          className="inline-flex items-center gap-2 bg-text text-bg px-6 py-3 text-[14px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
        >
          Read the datasets docs →
        </Link>
      </div>
    </section>
  );
}
