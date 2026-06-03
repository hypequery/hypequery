import CodeHighlight from '@/components/CodeHighlight';
import { BEFORE_QUERIES, BEFORE_METRICS, BEFORE_API, AFTER_CODE } from './constants';

export function LifecycleComparison() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 py-[96px] bg-bg-alt/30">
      <div className="mb-16 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Before vs After</p>
        <h2 className="text-h2 text-text max-w-[780px] mx-auto text-balance">
          Stop stitching together multiple tools. Use one.
        </h2>
        <p className="mt-4 text-body text-text-muted max-w-[640px] mx-auto text-pretty">
          Adopt what you need. When you need it.
        </p>
      </div>

      {/* Before - The Scattered Tools */}
      <div className="mb-12">
        <h3 className="text-h3 text-text mb-6 text-center">Before Hypequery</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* Queries */}
          <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
              <span className="font-mono text-[11px] text-text-muted">@clickhouse/client</span>
            </div>
            <div className="p-4">
              <CodeHighlight
                code={BEFORE_QUERIES}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
              />
            </div>
          </div>

          {/* Metrics */}
          <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
              <span className="font-mono text-[11px] text-text-muted">Cube.js / dbt</span>
            </div>
            <div className="p-4">
              <CodeHighlight
                code={BEFORE_METRICS}
                language="yaml"
                className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
              />
            </div>
          </div>

          {/* API */}
          <div className="overflow-hidden rounded-lg border border-border bg-bg-card">
            <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-2.5">
              <span className="font-mono text-[11px] text-text-muted">Express / your framework</span>
            </div>
            <div className="p-4">
              <CodeHighlight
                code={BEFORE_API}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[12.5px] [&_code]:leading-[1.75]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* After - Hypequery (One TypeScript Codebase) */}
      <div>
        <h3 className="text-h3 text-text mb-6 text-center">With Hypequery — One TypeScript Codebase</h3>
        <div className="overflow-hidden rounded-lg border border-border-strong bg-bg-card shadow-card ring-1 ring-accent/20">
          <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
            <span className="ml-3.5 font-mono text-[11.5px] text-text-muted">src/analytics/*</span>
            <span className="ml-auto font-mono text-[10px] font-bold tracking-[0.1em] uppercase text-accent bg-accent-soft px-2 py-0.5 rounded-sm">One codebase. Full type safety.</span>
          </div>
          <div className="p-4">
            <div className="rounded-lg border border-border bg-bg-alt px-5 py-4 ring-1 ring-accent/10">
              <CodeHighlight
                code={AFTER_CODE}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.85]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
