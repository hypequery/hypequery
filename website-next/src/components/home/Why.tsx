import CodeHighlight from '@/components/CodeHighlight';
import { OLD_WAY_CODE, HYPEQUERY_WAY_CODE } from './constants';

export function Why() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
      <div className="mb-12 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Why teams choose TypeScript</p>
        <h2 className="text-h2 text-text max-w-[780px] mx-auto text-balance">
          Everything in code. Nothing in YAML.
        </h2>
        <p className="mt-3.5 text-body text-text-muted max-w-[640px] mx-auto text-pretty">
          Stop juggling raw SQL strings, YAML configs, and scattered REST controllers. One TypeScript codebase. Full type safety.
        </p>
      </div>

      <div className="grid-responsive-2">
        {/* Old Way */}
        <article className="bg-bg-card border border-border rounded-lg overflow-hidden flex flex-col">
          <div className="p-7 pb-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <div>
                <h3 className="text-h4 text-text">The old way</h3>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-body-sm text-text-muted">
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>Raw SQL strings and Cube YAML configs.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>Query logic scattered across dashboards, scripts, and services.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>Metrics definitions duplicated and re-implemented per team.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-text-dim shrink-0">•</span>
                <span>No type safety — typos caught at runtime.</span>
              </p>
            </div>
          </div>
          <div className="min-h-[320px] p-4">
            <div className="bg-bg-alt h-full rounded-lg border border-border px-5 py-4">
              <CodeHighlight
                code={OLD_WAY_CODE}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
              />
            </div>
          </div>
        </article>

        {/* hypequery Way */}
        <article className="bg-bg-card border border-border-strong rounded-lg overflow-hidden flex flex-col relative ring-1 ring-accent/20">
          <div className="p-7 pb-4 border-b border-border">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-[38px] h-[38px] rounded-lg grid place-items-center font-mono text-[15px] font-bold bg-accent-soft text-accent shrink-0">
                ✓
              </div>
              <div>
                <h3 className="text-h4 text-text">The hypequery way</h3>
              </div>
            </div>
            <div className="mt-4 space-y-2 text-body-sm text-text-muted">
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span><strong className="text-text font-semibold">Everything is code.</strong></span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Type-safe queries with full autocomplete and compile-time checks.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Semantic datasets define metrics once, reused everywhere.</span>
              </p>
              <p className="flex items-start gap-2">
                <span className="text-accent shrink-0">•</span>
                <span>Auth, multi-tenancy, and caching stay consistent across every consumer.</span>
              </p>
            </div>
          </div>
          <div className="min-h-[320px] p-4">
            <div className="bg-bg-alt h-full rounded-lg border border-border px-5 py-4 ring-1 ring-accent/10">
              <CodeHighlight
                code={HYPEQUERY_WAY_CODE}
                language="typescript"
                className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8] h-full"
              />
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
