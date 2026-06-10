import CodeHighlight from '@/components/CodeHighlight';
import { DEFINE_ONCE_CODE } from './constants';

const INHERITS = [
  {
    label: 'A typed query',
    body: (
      <>
        <span className="font-mono text-text">executor.metric(averageOrderValue.by(&apos;month&apos;))</span> with full autocomplete; types flow from your schema to your results.
      </>
    ),
  },
  {
    label: 'A composable metric',
    body: (
      <>
        <span className="font-mono text-text">averageOrderValue</span> is derived from <span className="font-mono text-text">revenue</span> and <span className="font-mono text-text">orderCount</span> in plain TypeScript; the compiler checks the chain, <span className="font-mono text-text">toSQL</span> shows what runs.
      </>
    ),
  },
  {
    label: 'A REST API + React hook',
    body: (
      <>
        Pass it to <span className="font-mono text-text">serve()</span>, get an OpenAPI spec for free.
      </>
    ),
  },
  {
    label: 'An MCP tool',
    body: <>Agents query your metrics, never your tables.</>,
  },
  {
    label: 'Tenant-isolated by default',
    body: (
      <>
        That <span className="font-mono text-text">tenantKey</span> applies the row filter at runtime; conflicting tenant filters are rejected.
      </>
    ),
  },
];

export function DefineOnce() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="mb-10 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Your semantic layer, in code</p>
        <h2 className="text-h2 text-text mx-auto max-w-[680px] text-balance">
          Model your data once.
        </h2>
        <p className="mt-3.5 text-body text-text-muted mx-auto max-w-[600px] text-pretty">
          Build consistent, type-safe analytics products on top.
        </p>
      </div>

      <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
        <div className="bg-bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border px-5 py-3">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#ff5f56]" />
              <span className="h-2 w-2 rounded-full bg-[#ffbd2e]" />
              <span className="h-2 w-2 rounded-full bg-[#27c93f]" />
            </div>
          </div>
          <div className="bg-bg-alt p-5">
            <CodeHighlight
              code={DEFINE_ONCE_CODE}
              language="typescript"
              className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.8]"
            />
          </div>
        </div>

        <div>
          <p className="text-body text-text-muted text-pretty">
            That definition is now:
          </p>
          <div className="mt-5 grid gap-3">
            {INHERITS.map((item) => (
              <div key={item.label} className="rounded-lg border border-border bg-bg-card p-4">
                <div className="text-[14px] font-bold leading-tight text-text">{item.label}</div>
                <p className="mt-1.5 text-body-sm text-text-muted">{item.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 text-body-sm text-text-muted text-pretty">
            Zero drift between your dashboard, your API, and your agent.
          </p>
        </div>
      </div>
    </section>
  );
}
