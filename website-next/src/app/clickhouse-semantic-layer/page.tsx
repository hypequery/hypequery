import type { Metadata } from 'next';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Semantic Layer in TypeScript',
  description:
    'Define a ClickHouse semantic layer in TypeScript with typed datasets, tenant keys, time keys, and reusable delivery across APIs, jobs, and dashboards.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-semantic-layer'),
  },
  openGraph: {
    images: ogImage('ClickHouse Semantic Layer in TypeScript'),
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

const tenancyCode = `import { createDatasetClient } from '@hypequery/datasets';

// the old way — a filter you must remember, in 40 places
\`SELECT id, amount FROM orders WHERE tenant_id = '\${tenantId}'\`
// forget it once -> you leak a tenant's data

// with a dataset — declared once, applied from trusted runtime context
const analytics = createDatasetClient({ queryBuilder: db });

await analytics.execute(Orders, {
  dimensions: ['id', 'amount'],
}, { runtime: { tenant: { id: tenantId } } });
// tenant filter is injected automatically; missing scope fails closed`;

const payoffCode = `import { createDatasetClient } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';
import { db } from './client';
import { Orders, revenue } from './datasets';

const authStrategy = async ({ request }) => ({
  tenantId: request.headers['x-tenant-id'] as string,
});

const { serve } = initServe({
  auth: authStrategy,
  context: () => ({ db }),
});

export const analytics = createDatasetClient({ queryBuilder: db });

export const api = serve({
  queryBuilder: db,
  metrics: { revenue },
  datasets: { orders: Orders },
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
  },
});`;

const consumerCode = `// backend or worker
await analytics.execute(
  revenue,
  { dimensions: ['status'] },
  { runtime: { tenant: { id: tenantId } } },
);

// HTTP
await fetch('/api/analytics/metrics/revenue', {
  method: 'POST',
  body: JSON.stringify({ dimensions: ['status'] }),
});

// React
const { data } = useMetric('revenue', {
  dimensions: ['status'],
});`;

const comparisonRows = [
  {
    label: 'Lives in',
    detail: 'Where the semantic layer physically runs',
    hypequery: 'Your TypeScript codebase',
    platform: 'Separate service / platform',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Language',
    detail: 'How you author metrics and dimensions',
    hypequery: 'TypeScript',
    platform: 'YAML / modeling DSLs',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Types',
    detail: 'Compile-time safety from schema to response',
    hypequery: 'End-to-end TypeScript contracts',
    platform: 'Limited or external to app code',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Tenancy',
    detail: 'How rows are isolated per tenant',
    hypequery: 'Runtime-enforced from tenant context; typed fields',
    platform: 'Manual filters or platform policy',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Operate',
    detail: 'What you deploy and maintain in production',
    hypequery: 'A library in your stack',
    platform: 'A platform to run',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Best for',
    detail: 'The workload each shape fits',
    hypequery: 'Shipping ClickHouse-backed product features',
    platform: 'Centralized BI metrics and non-engineer consumers',
    hypequeryYes: true,
    platformYes: true,
  },
  {
    label: 'BI Support',
    detail: 'Fit for dashboards and self-serve BI tools',
    hypequery: 'Not a full BI modeling platform',
    platform: 'Better fit for broad BI governance',
    hypequeryYes: false,
    platformYes: true,
  },
] as const;

function Verdict({ yes }: { yes: boolean }) {
  return yes ? (
    <span className="mt-[2px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  ) : (
    <span className="mt-[2px] inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-text-dim/15 text-text-dim">
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3" aria-hidden="true">
        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

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
              data-umami-event="cta_click"
              data-umami-event-target="docs_datasets_overview"
              data-umami-event-location="hero_primary"
              className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
            >
              Read the datasets docs →
            </Link>
            <Link
              href="/docs/quick-start"
              data-umami-event="cta_click"
              data-umami-event-target="docs_quick_start"
              data-umami-event-location="hero_secondary"
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
              Register the dataset and its metrics directly. The same definition feeds server code, a validated HTTP route, a typed React hook, and governed MCP tools without redefining what revenue means.
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
            <div className="hidden grid-cols-[160px_1fr_1fr] gap-4 border-b border-border bg-bg-alt/60 px-5 py-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-text-dim md:grid">
              <span>Decision</span>
              <span>hypequery</span>
              <span>Cube / MetricFlow</span>
            </div>
            {comparisonRows.map((row) => (
              <div
                key={row.label}
                className="grid gap-3 border-b border-border px-5 py-4 text-[14px] last:border-b-0 md:grid-cols-[160px_1fr_1fr] md:items-start md:gap-4"
              >
                <div className="md:pt-[3px]">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-text-dim">
                    {row.label}
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-text-muted">{row.detail}</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <Verdict yes={row.hypequeryYes} />
                  <div>
                    <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-dim md:hidden">
                      hypequery
                    </span>
                    <span className="font-semibold text-text">{row.hypequery}</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <Verdict yes={row.platformYes} />
                  <div>
                    <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[0.1em] text-text-dim md:hidden">
                      Cube / MetricFlow
                    </span>
                    <span className="text-text-muted">{row.platform}</span>
                  </div>
                </div>
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
              data-umami-event="cta_click"
              data-umami-event-target="docs_quick_start"
              data-umami-event-location="footer_primary"
              className="bg-text text-bg px-5 py-3 text-[13.5px] font-semibold rounded transition hover:opacity-90 hover:-translate-y-px"
            >
              Get started →
            </Link>
            <Link
              href="/docs/datasets/overview"
              data-umami-event="cta_click"
              data-umami-event-target="docs_datasets_overview"
              data-umami-event-location="footer_secondary"
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
