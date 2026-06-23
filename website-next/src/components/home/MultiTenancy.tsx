import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import { TENANCY_OLD_WAY, TENANCY_HYPEQUERY_WAY } from './constants';

export function MultiTenancy() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
      <div className="mb-12 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Define once. Inherit everywhere.</p>
        <h2 className="text-h2 text-text max-w-[780px] mx-auto text-balance">
          Multi-tenancy you can't forget.
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[680px] mx-auto text-pretty">
          The hardest bug to catch is the one you forget to write. Declare <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">tenantKey</code> on the dataset, and every semantic query — in every service, job, and dashboard — inherits the tenant filter. Require tenant context in Serve, and requests without it fail before the query runs.
        </p>
      </div>

      <div className="grid-responsive-2 mb-12">
        <article className="bg-bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="p-5 pb-3 border-b border-border">
            <h3 className="text-[15px] font-bold text-text mb-2">The old way — a filter you have to remember, every time:</h3>
          </div>
          <div className="p-4">
            <div className="bg-bg-alt rounded-lg border border-border px-5 py-4">
              <CodeHighlight
                code={TENANCY_OLD_WAY}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
              />
            </div>
          </div>
        </article>

        <article className="bg-bg-card border border-border-strong rounded-lg overflow-hidden flex flex-col ring-1 ring-accent/20">
          <div className="p-5 pb-3 border-b border-border">
            <h3 className="text-[15px] font-bold text-text mb-2">The hypequery way — declare it once, enforced everywhere:</h3>
          </div>
          <div className="p-4">
            <div className="bg-bg-alt rounded-lg border border-border px-5 py-4 ring-1 ring-accent/10">
              <CodeHighlight
                code={TENANCY_HYPEQUERY_WAY}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
              />
            </div>
          </div>
        </article>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="p-5 bg-bg-card border border-border rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">1</div>
          <div className="text-[15px] font-bold text-text mb-2">Declare once.</div>
          <p className="text-body-sm text-text-muted">
            Set <code className="font-mono text-[0.9em]">tenantKey</code> on the dataset. That's the only place it lives.
          </p>
        </div>

        <div className="p-5 bg-bg-card border border-border rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">2</div>
          <div className="text-[15px] font-bold text-text mb-2">Inherited everywhere.</div>
          <p className="text-body-sm text-text-muted">
            Every query — API routes, background jobs, React hooks — carries the filter. No checklist, no manual WHERE.
          </p>
        </div>

        <div className="p-5 bg-bg-card border border-border rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold mb-3">3</div>
          <div className="text-[15px] font-bold text-text mb-2">Caught at compile time.</div>
          <p className="text-body-sm text-text-muted">
            Dataset fields, filters, and metrics are typed. Misspell one and TypeScript fails the build before it reaches production.
          </p>
        </div>
      </div>

      <div className="p-6 bg-bg-card border border-border-strong rounded-lg mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent grid place-items-center font-mono text-lg font-bold shrink-0">T</div>
          <div>
            <div className="text-[15px] font-bold text-text mb-2">Time, too.</div>
            <p className="text-body-sm text-text-muted">
              Set <code className="font-mono text-[0.9em]">timeKey</code> once and every query knows its time column — date-range filters and day/week/month grouping use ClickHouse-optimized time functions automatically.
            </p>
          </div>
        </div>
      </div>

      <div className="text-center">
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
