import type { Metadata } from 'next';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Semantic Layer in TypeScript | hypequery',
  description:
    'Define a ClickHouse semantic layer in TypeScript with typed datasets, tenant keys, time keys, and reusable delivery across APIs, jobs, and dashboards.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-semantic-layer'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-semantic-layer'),
    title: 'ClickHouse Semantic Layer in TypeScript | hypequery',
    description:
      'A code-first ClickHouse semantic layer for TypeScript teams. No YAML, no separate platform, no service to run.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Semantic Layer in TypeScript | hypequery',
    description:
      'Model ClickHouse tables once in TypeScript and reuse the same typed definitions across APIs, jobs, and dashboards.',
  },
};

const datasetCode = `import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',   // every semantic query is tenant-scoped
  timeKey: 'created_at',    // every semantic query knows its time column
  dimensions: {
    id:        dimension.string(),
    amount:    dimension.number(),
    status:    dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});`;

const tenancyCode = `// the old way — a filter you must remember, in 40 places
\`SELECT id, amount FROM orders WHERE tenant_id = '\${tenantId}'\`
// forget it once -> you leak a tenant's data

// with a dataset — declared once, applied from runtime context
await executor.dataset(Orders, {
  dimensions: ['id', 'amount'],
}, { runtime: { tenant: { id: tenantId } } });
// tenant filter injected automatically when runtime tenancy is active`;

const payoffCode = `import { createExecutor, eq, gte } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';
import { Orders } from './datasets';

const executor = createExecutor({ queryBuilder: db });
const auth = async ({ request }) => ({
  tenantId: request.headers['x-tenant-id'] as string,
});

const { query, serve } = initServe({
  auth,
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
  },
  context: ({ request }) => ({
    db,
    executor,
    tenantId: request.headers['x-tenant-id'] as string,
  }),
});

export const revenueByDay = query({
  input: z.object({
    startDate: z.string(),
  }),
  query: ({ ctx, input }) =>
    ctx.executor.dataset(Orders, {
      dimensions: ['createdAt'],
      measures: ['revenue'],
      filters: [gte('createdAt', input.startDate), eq('status', 'paid')],
    }, { runtime: { tenant: { id: ctx.tenantId } } }),
});

export const api = serve({
  queries: { revenueByDay },
  datasets: { orders: Orders },
  queryBuilder: db,
});`;

const consumerCode = `// server code
const result = await api.run('revenueByDay', {
  input: { startDate: '2026-04-01' },
});

// HTTP
await fetch('/api/analytics/revenueByDay', {
  method: 'POST',
  body: JSON.stringify({ startDate: '2026-04-01' }),
});

// React
const { data } = useQuery('revenueByDay', {
  startDate: '2026-04-01',
});`;

const comparisonRows = [
  ['Lives in', 'Your TypeScript codebase', 'Separate service / platform'],
  ['Language', 'TypeScript', 'YAML / modeling DSLs'],
  ['Types', 'End-to-end TypeScript contracts', 'Limited or external to app code'],
  ['Tenancy', 'Runtime-enforced from tenant context; typed fields', 'Manual filters or platform policy'],
  ['Operate', 'A library in your stack', 'A platform to run'],
  ['Best for', 'Shipping ClickHouse-backed product features', 'Centralized BI metrics and non-engineer consumers'],
  ['Honest concession', 'Not a BI modeling platform', 'Better fit for broad BI governance'],
] as const;

function CodeCard({ title, code }: { title: string; code: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-strong bg-bg-card shadow-card">
      <div className="flex items-center gap-1.5 border-b border-border bg-bg-alt/60 px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
        <span className="ml-3.5 font-mono text-[11.5px] text-text-muted">{title}</span>
      </div>
      <div className="bg-bg-card p-4">
        <CodeHighlight
          code={code}
          language="typescript"
          className="[&_code]:font-mono [&_code]:text-[13.5px] [&_code]:leading-[1.85]"
        />
      </div>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-10">
      {eyebrow ? <p className="font-mono text-eyebrow text-accent mb-3.5">{eyebrow}</p> : null}
      <h2 className="text-h2 text-text max-w-[780px] text-balance">{title}</h2>
      <div className="mt-3.5 max-w-[700px] space-y-4 text-body text-text-muted text-pretty">{children}</div>
    </div>
  );
}

export default function ClickHouseSemanticLayerPage() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <Navigation />
      <main className="pt-[98px]">
        <section className="mx-auto max-w-[1280px] px-8 pt-[120px] pb-14">
          <p className="font-mono text-eyebrow text-accent mb-4">ClickHouse semantic layer</p>
          <h1 className="text-display text-text max-w-[980px] text-balance">
            The ClickHouse semantic layer you define in TypeScript
          </h1>
          <p className="mt-[22px] text-body-lg text-text-muted max-w-[720px] text-pretty">
            Model your table once — tenant key, time key, typed fields — and every semantic query inherits it. Across your APIs, jobs, and dashboards. No YAML. No separate platform. No service to run.
          </p>
          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/docs/datasets/overview"
              className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
            >
              Read the datasets docs →
            </Link>
            <Link
              href="/docs/quick-start"
              className="bg-transparent text-text px-5 py-3 text-[13.5px] font-semibold rounded border border-border-strong transition hover:border-text hover:bg-bg-alt"
            >
              Get started →
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-8 pt-[72px] pb-6">
          <SectionIntro title="Your semantic layer is a TypeScript file.">
            <p>
              A dataset declares your table, its tenant key, its time key, dimensions, and measures — once. Semantic queries built on it carry tenant and time context automatically when runtime tenancy is active. Change the definition; downstream usage follows the same typed contract.
            </p>
          </SectionIntro>
          <CodeCard title="datasets/orders.ts" code={datasetCode} />
        </section>

        <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
          <SectionIntro title="A semantic layer doesn't have to be a platform.">
            <p>
              The standard answer to “ClickHouse semantic layer” is Cube or dbt MetricFlow — a separate service, modeled outside your application stack, run alongside your code. That is the right tool when centralized BI metrics for non-engineers is the job.
            </p>
            <p>
              For a TypeScript team shipping product features, it is often the wrong shape. Your semantic layer should live in your codebase, your types, and your deploys. Datasets put it there: one definition, governed everywhere, without adopting a separate platform.
            </p>
          </SectionIntro>
        </section>

        <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <SectionIntro title="Multi-tenancy you can't forget.">
              <p>
                The worst bug is the filter you forget to write. Declare <code className="font-mono text-[0.92em] text-text bg-bg-alt px-1.5 py-0.5 rounded-sm">tenantKey</code> once on the dataset and semantic execution injects the tenant filter from runtime context. In Serve, require tenant context and requests without it fail before query execution.
              </p>
              <p className="text-body-sm text-text-dim">
                TypeScript checks the fields, dimensions, measures, and filters you reference. Tenant identity itself is enforced at runtime because it comes from auth/request context.
              </p>
            </SectionIntro>
            <CodeCard title="tenant-scope.ts" code={tenancyCode} />
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
          <SectionIntro title="One definition. Every consumer.">
            <p>
              Compose query definitions around the dataset and serve them anywhere — the same definition feeds server code, a typed HTTP route, and a React hook, with types intact across the network.
            </p>
          </SectionIntro>
          <div className="grid gap-4 lg:grid-cols-2">
            <CodeCard title="analytics/revenue-by-day.ts" code={payoffCode} />
            <CodeCard title="consumers.ts" code={consumerCode} />
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-8 pt-[96px] pb-6">
          <SectionIntro title="hypequery vs Cube / dbt MetricFlow">
            <p>
              Both shapes can be correct. The question is whether you want a TypeScript semantic layer inside your product codebase, or a separate metrics platform for centralized BI.
            </p>
          </SectionIntro>
          <div className="overflow-hidden rounded-lg border border-border-strong bg-bg-card shadow-card">
            <div className="grid grid-cols-[150px_1fr_1fr] border-b border-border bg-bg-alt/60 px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-dim">
              <span>Decision</span>
              <span>hypequery</span>
              <span>Cube / MetricFlow</span>
            </div>
            {comparisonRows.map(([label, hypequery, platform]) => (
              <div
                key={label}
                className="grid grid-cols-1 gap-2 border-b border-border px-4 py-4 text-[14px] last:border-b-0 md:grid-cols-[150px_1fr_1fr]"
              >
                <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-text-dim">{label}</div>
                <div className="font-semibold text-text">{hypequery}</div>
                <div className="text-text-muted">{platform}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1280px] px-8 py-20 text-center">
          <p className="font-mono text-eyebrow text-accent mb-3.5">Next step</p>
          <h2 className="text-h1 text-text max-w-[780px] mx-auto text-balance">
            Define your first dataset in 30 seconds.
          </h2>
          <p className="mt-[18px] mx-auto inline-block">
            <span className="font-mono text-[15px] text-text bg-bg-alt border border-border-strong px-3.5 py-2 rounded">
              npx @hypequery/cli init
            </span>
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2.5">
            <Link
              href="/docs/quick-start"
              className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
            >
              Get started →
            </Link>
            <Link
              href="/docs/datasets/overview"
              className="bg-transparent text-text px-5 py-3 text-[13.5px] font-semibold rounded border border-border-strong transition hover:border-text hover:bg-bg-alt"
            >
              Read the datasets docs →
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
