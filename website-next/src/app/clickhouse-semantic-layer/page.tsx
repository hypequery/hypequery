import type { Metadata } from 'next';
import Link from 'next/link';
import CodeHighlight from '@/components/CodeHighlight';
import ExamplesBlock from '@/components/examples/ExamplesBlock';
import Footer from '@/components/Footer';
import Navigation from '@/components/Navigation';
import { OpenSourceBadge } from '@/components/home/OpenSourceBadge';
import { SetupCommand } from '@/components/home/SetupCommand';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { HubDefinition, HubLinkGrid, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Semantic Layer in TypeScript and Python',
  description:
    'Define a ClickHouse semantic layer in TypeScript or Python with typed datasets, tenant keys, and time keys. Serve it to APIs, dashboards, and AI agents from your own backend.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-semantic-layer'),
  },
  openGraph: {
    images: ogImage('ClickHouse Semantic Layer in TypeScript and Python'),
    type: 'website',
    url: absoluteUrl('/clickhouse-semantic-layer'),
    title: 'ClickHouse Semantic Layer in TypeScript and Python | hypequery',
    description:
      'A code-first ClickHouse semantic layer for TypeScript teams. No YAML, no separate platform, no service to run.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Semantic Layer in TypeScript and Python | hypequery',
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
import { Orders } from './datasets';
import { verifyAuth } from './auth'; // your session or JWT check

const { serve } = initServe({
  // the tenant comes from the verified session, never from the request
  auth: verifyAuth,
  tenant: {
    extract: (auth) => auth.tenantId,
    required: true,
  },
  context: () => ({ db }),
});

export const analytics = createDatasetClient({ queryBuilder: db });

export const api = serve({
  queryBuilder: db,
  datasets: { orders: Orders },
});`;

const consumerCode = `// backend or worker
await analytics.execute(
  Orders,
  { dimensions: ['status'], measures: ['revenue'] },
  { runtime: { tenant: { id: tenantId } } },
);

// HTTP
await fetch('/api/analytics/datasets/orders/query', {
  method: 'POST',
  body: JSON.stringify({ dimensions: ['status'], measures: ['revenue'] }),
});

// React
const { data } = useDataset('orders', {
  dimensions: ['status'],
  measures: ['revenue'],
});

// AI agents, over MCP
//   npx hypequery mcp --tenant acme`;

const comparisonRows = [
  {
    label: 'Lives in',
    detail: 'Where the semantic layer physically runs',
    hypequery: 'Your codebase, in TypeScript or Python',
    platform: 'Separate service / platform',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Language',
    detail: 'How you author metrics and dimensions',
    hypequery: 'TypeScript or Python',
    platform: 'YAML / modeling DSLs',
    hypequeryYes: true,
    platformYes: false,
  },
  {
    label: 'Types',
    detail: 'Compile-time safety from schema to response',
    hypequery: 'Typed contracts from schema to response',
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
    hypequery: 'A library in your stack (a hosted option is coming soon)',
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

// The shared vocabulary of semantic layers, so the page answers "what is a semantic layer" directly.
const vocabulary = [
  { term: 'Dimensions', copy: 'The attributes you slice by: region, plan, status, signup date. They end up in GROUP BY and WHERE.' },
  { term: 'Measures', copy: 'Aggregations bound to a column, such as sum(total) or count(id), optionally with a filter built in.' },
  { term: 'Metrics', copy: 'Named business quantities built from measures. Average order value is revenue divided by order count.' },
  { term: 'Grain', copy: 'The time level a result is aggregated to, driven by one agreed time column: daily, weekly, monthly.' },
  { term: 'Governed filters', copy: 'Conditions that always apply, whether or not the caller asks. Tenant isolation is the usual one.' },
] as const;

const shapes = [
  { name: 'Inside a BI tool', copy: 'LookML or Power BI datasets. Consistent inside that tool, unavailable to your app code and APIs.' },
  { name: 'Standalone platform', copy: 'Cube runs as a separate service with its own query API and pre-aggregation store.' },
  { name: 'Warehouse side', copy: 'dbt MetricFlow keeps metrics in YAML next to your models. It still needs a runtime layer to serve app requests.' },
  { name: 'Code-first library', copy: 'Definitions are typed code in your repo, imported by your backend and deployed with it. This is hypequery.' },
] as const;

const guideLinks: HubLink[] = [
  {
    href: '/docs/datasets/overview',
    title: 'Datasets docs',
    description: 'Define datasets, dimensions, measures and metrics in TypeScript, then execute and serve them.',
  },
  {
    href: '/docs/datasets/metrics',
    title: 'Metrics docs',
    description: 'Attach named KPIs and derived calculations, such as average order value, to datasets.',
  },
  {
    href: '/docs/datasets/multi-tenancy',
    title: 'Dataset multi-tenancy',
    description: 'How tenant keys are enforced at runtime and why missing tenant context fails closed.',
  },
  {
    href: '/python-semantic-layer',
    title: 'Python semantic layer',
    description: 'The same datasets and Serve protocol for FastAPI, Django and Flask backends.',
  },
  {
    href: '/blog/introducing-hypequery-datasets',
    title: 'Introducing hypequery datasets',
    description: 'Define dimensions, measures and metrics once, then reuse them across code, APIs, dashboards and agents.',
  },
  {
    href: '/blog/introducing-hypequery-python',
    title: 'Introducing hypequery for Python',
    description: 'The Python SDK: datasets, serving and DataFrames over ClickHouse.',
  },
  {
    href: '/clickhouse-mcp',
    title: 'ClickHouse MCP server',
    description: 'Expose datasets to Claude, Cursor and other MCP clients without raw SQL.',
  },
  {
    href: '/compare/hypequery-vs-cube',
    title: 'hypequery vs Cube',
    description: 'A code-first library compared with a configuration-first semantic layer platform.',
  },
  {
    href: '/cube-js-alternative',
    title: 'Cube.js alternative for ClickHouse',
    description: 'A semantic layer with no Cube server, Redis cache or YAML to run.',
  },
  {
    href: '/compare/hypequery-vs-dbt',
    title: 'hypequery vs dbt',
    description: 'Scheduled transformations in dbt compared with request-time serving from your app.',
  },
  {
    href: '/blog/typescript-vs-dbt-clickhouse',
    title: 'TypeScript vs dbt for ClickHouse',
    description: 'Which one belongs in your ClickHouse stack, and when you need both.',
  },
  {
    href: '/embedded-analytics',
    title: 'Embedded analytics',
    description: 'Serving tenant-scoped metrics to customers: build vs buy and vendors compared.',
  },
];

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
    <div className="overflow-hidden rounded-xl border border-border-strong bg-bg-card shadow-card">
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
      {eyebrow ? <p className={`mb-3.5 ${marketing.eyebrow}`}>{eyebrow}</p> : null}
      <h2 className={`max-w-[780px] text-balance ${marketing.sectionTitle}`}>{title}</h2>
      <div className="mt-3.5 max-w-[700px] space-y-4 text-body text-text-muted text-pretty">{children}</div>
    </div>
  );
}

export default function ClickHouseSemanticLayerPage() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <Navigation />
      <main className="pt-[62px]">
        <section className={`${marketing.container} pb-14 pt-12 sm:pt-16`}>
          <div className="flex flex-wrap items-center gap-3">
            <OpenSourceBadge />
            <p className={marketing.eyebrow}>ClickHouse semantic layer</p>
          </div>
          <h1 className={`mt-5 max-w-[980px] text-balance ${marketing.heroTitle}`}>
            The ClickHouse semantic layer you define in TypeScript or Python
          </h1>
          <p className={`mt-5 max-w-[700px] text-pretty ${marketing.heroLead}`}>
            Model your table once — tenant key, time key, typed fields — and every query inherits it, across your APIs, dashboards, and AI agents. No YAML. Run it in your own backend.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              data-umami-event="cta_click"
              data-umami-event-target="docs_home"
              data-umami-event-location="hero_primary"
              className={marketing.primaryButton}
            >
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/docs/datasets/overview"
              data-umami-event="cta_click"
              data-umami-event-target="docs_datasets_overview"
              data-umami-event-location="hero_secondary"
              className={marketing.secondaryButton}
            >
              Read the datasets docs
            </Link>
          </div>
          <SetupCommand className="mt-4" />
          <p className="mt-4 text-sm text-text-muted">
            Working in Python?{' '}
            <Link href="/python-semantic-layer" className="font-medium text-text underline decoration-border underline-offset-2 hover:decoration-accent">
              See the Python semantic layer
            </Link>
          </p>
        </section>

        <section className={`${marketing.container} pb-6 pt-6`}>
          <HubDefinition term="What is a semantic layer?">
            <p>
              A semantic layer is a single, shared definition of your business metrics that sits between your raw tables
              and everything that queries them. Dashboards, APIs, notebooks and AI agents ask it for &ldquo;revenue&rdquo;
              by name, and the layer decides which column, aggregate, filters and time column that means, so every
              consumer gets the same number and no caller can skip a filter that must always apply.
            </p>
          </HubDefinition>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {vocabulary.map((item) => (
              <div key={item.term} className="rounded-xl border border-border bg-bg-card p-5">
                <dt className="text-sm font-semibold text-text">{item.term}</dt>
                <dd className="mt-2 text-[13px] leading-5 text-text-muted">{item.copy}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className={`${marketing.container} pb-6 pt-[72px]`}>
          <SectionIntro title="Your semantic layer is a file in your repo.">
            <p>
              A dataset declares your table, its tenant key, its time key, dimensions, and measures — once. Semantic queries built on it carry tenant and time context automatically when runtime tenancy is active. Change the definition; downstream usage follows the same typed contract.
            </p>
          </SectionIntro>
          <CodeCard title="datasets/orders.ts" code={datasetCode} />
        </section>

        <section className={`${marketing.container} pb-6 pt-[96px]`}>
          <SectionIntro title="A semantic layer doesn't have to be a separate platform.">
            <p>
              The standard answer to “ClickHouse semantic layer” is Cube or dbt MetricFlow — a separate service, modeled outside your application stack, run alongside your code. That is the right tool when centralized BI metrics for non-engineers is the job.
            </p>
            <p>
              For a team shipping product features, it is often the wrong shape. Your semantic layer should live in your codebase, your types, and your deploys. Datasets put it there: one definition, in TypeScript or Python, governed everywhere. Run it in your own backend, or let hypequery cloud host the same definitions.
            </p>
          </SectionIntro>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {shapes.map((shape) => (
              <div key={shape.name} className="rounded-xl border border-border bg-bg-card p-5">
                <h3 className="text-sm font-semibold text-text">{shape.name}</h3>
                <p className="mt-2 text-[13px] leading-5 text-text-muted">{shape.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`${marketing.container} pb-6 pt-[96px]`}>
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

        <section className={`${marketing.container} pb-6 pt-[96px]`}>
          <SectionIntro title="One definition. Every consumer.">
            <p>
              Register the dataset once. The same definition feeds server code, a validated HTTP route, a typed React hook, and governed MCP tools, without redefining what revenue means.
            </p>
          </SectionIntro>
          <div className="grid gap-4 lg:grid-cols-2">
            <CodeCard title="analytics/revenue-by-day.ts" code={payoffCode} />
            <CodeCard title="consumers.ts" code={consumerCode} />
          </div>
        </section>

        <section className={`${marketing.container} pb-6 pt-[96px]`}>
          <SectionIntro title="hypequery vs Cube / dbt MetricFlow">
            <p>
              Both shapes can be correct. The question is whether you want a semantic layer inside your product codebase, or a separate metrics platform for centralized BI.
            </p>
          </SectionIntro>
          <div className="overflow-hidden rounded-xl border border-border-strong bg-bg-card shadow-card">
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

        <ExamplesBlock leadPage="/clickhouse-semantic-layer" />
        <section className={`${marketing.container} pb-6 pt-[96px]`}>
          <SectionIntro eyebrow="Guides" title="Semantic layer guides and docs">
            <p>
              Docs, design notes and comparisons for defining a ClickHouse semantic layer in code and serving it to APIs,
              dashboards and agents.
            </p>
          </SectionIntro>
          <HubLinkGrid links={guideLinks} />
        </section>

        <section className={`${marketing.container} py-20 text-center`}>
          <p className={`mb-3.5 ${marketing.eyebrow}`}>Next step</p>
          <h2 className={`mx-auto max-w-[780px] text-balance ${marketing.sectionTitle}`}>
            Define your first dataset in 30 seconds.
          </h2>
          <p className="mx-auto mt-3.5 max-w-[560px] text-body text-pretty text-text-muted">
            Start open source in your own backend. A hosted option, hypequery cloud, is coming soon.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/docs"
              data-umami-event="cta_click"
              data-umami-event-target="docs_home"
              data-umami-event-location="footer_primary"
              className={marketing.primaryButton}
            >
              Get started <span aria-hidden="true">→</span>
            </Link>
            <DeployWaitlist location="semantic-layer-final" className={marketing.secondaryButton} />
          </div>
          <SetupCommand className="mt-4 justify-center" />
        </section>
      </main>
      <Footer />
    </div>
  );
}
