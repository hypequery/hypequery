import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, type HubLink } from '@/components/hub-page';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { marketing } from '@/components/ui/marketing';
import { getGithubStars } from '@/lib/github-stars';
import { getNpmDownloadCounts } from '@/lib/npm-downloads';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';

// This page was the "ClickHouse SaaS analytics" pillar. It now targets the
// "embedded analytics for SaaS" / "saas dashboard" cluster at the same URL,
// so the existing links and any ranking history carry over.
const PATH = '/clickhouse-saas-analytics';
const TITLE = 'Embedded Analytics for SaaS on ClickHouse';
const DESCRIPTION =
  'Build multi-tenant SaaS dashboards, customer-facing APIs and AI agents on ClickHouse from one typed analytics layer, with tenant isolation built in.';
const PUBLISHED = '2026-04-25';
const UPDATED = '2026-11-12';

// Proof numbers are fetched at render time and cached for an hour; never hard-code them.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'website',
    url: absoluteUrl(PATH),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
    images: ogImage(TITLE),
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';

// Type-checked against @hypequery/clickhouse 2.15.0, @hypequery/datasets 0.30.0 and @hypequery/serve 0.25.0.
const datasetCode = `import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'account_id', // every query is filtered to one customer account
  timeKey: 'created_at',
  dimensions: {
    status: dimension.string(),
    country: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('order_id'),
    revenue: measure.sum('amount'),
  },
});`;

const serveCode = `import { initServe } from '@hypequery/serve';
import { db } from './client'; // your createQueryBuilder instance
import { Orders } from './datasets';
import { verifySession } from './auth'; // your JWT or session check

const { serve } = initServe({
  // The tenant comes from the verified session, never from the request body.
  auth: async ({ request }) => verifySession(request.headers.authorization),
  tenant: { extract: (auth) => auth?.tenantId, required: true },
});

export const api = serve({
  queryBuilder: db,
  datasets: { orders: { dataset: Orders, requiredScopes: ['analytics:read'] } },
});`;

const faqItems: FaqItem[] = [
  {
    question: 'What is embedded analytics for SaaS?',
    answer:
      'Embedded analytics for SaaS means the reports, charts and exports a SaaS product shows its own customers, each limited to that customer’s account. Typical examples are a usage dashboard, an invoice breakdown or an activity feed with counts.',
  },
  {
    question: 'How does hypequery isolate tenants?',
    answer:
      'Each hypequery dataset can declare a tenant key, the column that identifies the customer. Queries must carry a trusted tenant value from your server; hypequery adds the filter itself, rejects queries without a tenant, and rejects callers who try to filter on the tenant column.',
  },
  {
    question: 'Does hypequery include chart components?',
    answer:
      'No. hypequery serves data: typed HTTP endpoints, React hooks built on TanStack Query, and MCP tools. You draw charts with the component library you already use. If you want a vendor to supply charts and a dashboard editor, an embedded BI product such as Luzmo or Embeddable fits better.',
  },
  {
    question: 'Which databases does hypequery support?',
    answer:
      'ClickHouse only: ClickHouse Cloud, self-hosted ClickHouse, and chDB for in-process use from Python. There is no Postgres, BigQuery or Snowflake support today.',
  },
  {
    question: 'Is hypequery free?',
    answer:
      'Yes, the libraries are. Every hypequery package is Apache 2.0 and you deploy it with your own backend. A managed hypequery cloud is still to launch; you can join its waitlist, and no pricing has been set.',
  },
];

const nextLinks: HubLink[] = [
  {
    href: '/compare/embedded-analytics-platforms',
    title: 'Embedded analytics platforms compared',
    description: 'Code-first layers, embedded BI and BI tools with embedding, side by side.',
  },
  {
    href: '/compare/embedded-analytics-pricing',
    title: 'Embedded analytics pricing',
    description: 'What each platform costs to embed, with a 1,000-viewer scenario worked through.',
  },
  {
    href: '/blog/embedded-analytics-clickhouse-multi-tenant-dashboards',
    title: 'Multi-tenant embedded analytics on ClickHouse',
    description: 'Schema design, row policies, rollups and per-tenant limits for customer-facing dashboards.',
  },
  {
    href: '/docs/datasets/multi-tenancy',
    title: 'Dataset multi-tenancy docs',
    description: 'Tenant keys, runtime tenant context, and why execution fails closed.',
  },
  {
    href: '/docs/mcp/overview',
    title: 'MCP server docs',
    description: 'Expose the same datasets to AI agents as governed tools instead of raw SQL.',
  },
  {
    href: '/compare/luzmo-alternatives',
    title: 'Luzmo alternatives',
    description: 'Options grouped by why teams leave an embedded BI product.',
  },
  {
    href: '/compare/hypequery-vs-embeddable',
    title: 'hypequery vs Embeddable',
    description: 'A code-first layer next to a component-based embedding platform.',
  },
  {
    href: '/cube-js-alternative',
    title: 'Cube alternatives',
    description: 'Semantic layers compared for embedded analytics and AI agents.',
  },
  {
    href: '/use-cases/multi-tenant-saas',
    title: 'Multi-tenant SaaS use case',
    description: 'A worked example of tenant context and role checks in a SaaS backend.',
  },
];

/** App → hypequery → ClickHouse, with the three outputs. Plain HTML so the text is crawlable. */
function ArchitectureDiagram() {
  const box = 'rounded-lg border border-border-strong bg-bg-card px-4 py-3 text-sm';
  const arrow = 'select-none text-center font-mono text-text-dim';
  return (
    <figure className="rounded-xl border border-border bg-bg-alt/40 p-5 sm:p-8">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto_1.4fr_auto_1fr] lg:items-center">
        <div className={box}>
          <p className="font-medium text-text">Your SaaS app</p>
          <p className="mt-1 text-text-muted">Signs in the user and knows their account (tenant) and role.</p>
        </div>
        <p aria-hidden="true" className={arrow}>
          <span className="inline-block lg:-rotate-90">↓</span>
        </p>
        <div className={`${box} border-accent/60`}>
          <p className="font-medium text-text">hypequery datasets, in your repo</p>
          <ul className="mt-1 space-y-0.5 text-text-muted">
            <li>Measures, dimensions and joins, typed in TypeScript or Python</li>
            <li>Tenant key: one filter, applied to every query</li>
            <li>Roles and scopes per endpoint</li>
          </ul>
        </div>
        <p aria-hidden="true" className={arrow}>
          <span className="inline-block lg:-rotate-90">↓</span>
        </p>
        <div className={box}>
          <p className="font-medium text-text">ClickHouse</p>
          <p className="mt-1 text-text-muted">ClickHouse Cloud, self-hosted, or chDB.</p>
        </div>
      </div>
      <p aria-hidden="true" className={`${arrow} my-3`}>
        ↓ the same definitions serve ↓
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={box}>
          <p className="font-medium text-text">In-app dashboards</p>
          <p className="mt-1 text-text-muted">React hooks over typed endpoints; your own chart components.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">Customer-facing API</p>
          <p className="mt-1 text-text-muted">REST endpoints with validation and an OpenAPI spec.</p>
        </div>
        <div className={box}>
          <p className="font-medium text-text">AI agents</p>
          <p className="mt-1 text-text-muted">An MCP server that exposes datasets as tools, scoped to one tenant.</p>
        </div>
      </div>
      <figcaption className="mt-5 text-xs leading-5 text-text-dim">
        One typed model between your app and ClickHouse. Dashboards, the public API and agents all read the same
        metric definitions and the same tenant rule.
      </figcaption>
    </figure>
  );
}

export default async function EmbeddedAnalyticsForSaasPage() {
  const [npmCounts, stars] = await Promise.all([getNpmDownloadCounts(), getGithubStars()]);
  const monthlyDownloads = npmCounts ? npmCounts.reduce((sum, count) => sum + count, 0) : null;

  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Embedded analytics', href: '/embedded-analytics' },
        { label: 'For SaaS' },
      ]}
      eyebrow="Embedded analytics for SaaS"
      title="Build multi-tenant SaaS analytics on ClickHouse"
      updated={UPDATED}
      lead={
        <p>
          A SaaS dashboard has to answer the same question for hundreds of customers without ever mixing their data.
          hypequery puts the metrics, dimensions and tenant rule in one typed ClickHouse model in your repo. That model
          serves the in-app dashboard, customer-facing API and AI agents, with every query scoped to the signed-in
          customer before it reaches the database.
        </p>
      }
      primaryCta={{ href: '/docs/quick-start', label: 'Get started', target: 'docs_quick_start' }}
      secondaryCta={{ href: '#how-it-works', label: 'How it works', target: 'saas_how_it_works' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="The problem"
        title="Why SaaS analytics gets harder after the first dashboard"
        intro={
          <>
            <p>
              The first customer dashboard is easy: a few SQL queries behind an endpoint. The cost shows up later, in
              three places.
            </p>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Tenant leaks</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              When each query adds <code className={inlineCode}>WHERE account_id = ?</code> itself, a single omission
              sends one account’s numbers to another. Code review rarely catches a line that isn’t there.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Slow queries</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              A dashboard that is fast for a small account can time out for the largest one. On ClickHouse the fix is
              mostly table design: the tenant column first in the sorting key, and rollups for the heaviest charts.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Metric drift</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              “Revenue” gets written once for the dashboard, again for the CSV export and again for the public API.
              Within a quarter the three disagree, and support tickets ask which number is right.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        id="how-it-works"
        band
        eyebrow="How it works"
        title="One model between your app and ClickHouse"
        intro={
          <p>
            You describe each table once as a dataset: what can be counted or summed, what can be grouped by, and which
            column identifies the customer. hypequery turns requests into ClickHouse SQL, adds the tenant filter from
            the signed-in session, and serves the result to whichever surface asked.
          </p>
        }
      >
        <ArchitectureDiagram />
        <div className="mt-10 grid gap-6 lg:grid-cols-2 lg:items-start">
          <CodeWindow code={datasetCode} filename="analytics/datasets.ts" />
          <CodeWindow code={serveCode} filename="analytics/api.ts" />
        </div>
        <div className="mt-6 max-w-[760px] space-y-4 text-body text-text-muted">
          <p>
            With <code className={inlineCode}>tenantKey</code> set, a query without a tenant throws instead of running,
            and a caller who adds their own filter on <code className={inlineCode}>account_id</code> is rejected. The
            endpoint above also requires the <code className={inlineCode}>analytics:read</code> scope. These rules live
            in the dataset file, so a change to them shows up in a pull request like any other code. The{' '}
            <Link href="/docs/datasets/multi-tenancy" className={inlineLink}>
              multi-tenancy docs
            </Link>{' '}
            cover cross-tenant admin scopes and tenant context for MCP.
          </p>
        </div>
      </HubSection>

      <HubSection
        eyebrow="What you can build"
        title="Dashboards, APIs and agents from the same definitions"
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>In-app dashboards</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              <code className={inlineCode}>@hypequery/react</code> generates typed hooks for each endpoint, built on
              TanStack Query. You render the result with your design system’s charts, so the dashboard looks like the
              rest of your product. See{' '}
              <Link href="/clickhouse-react" className={inlineLink}>
                ClickHouse with React
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>A customer-facing API</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Customers who want the numbers in their own tools get the same endpoints, with request validation, auth
              and an OpenAPI spec generated from the datasets. The API and the dashboard cannot disagree because they run
              the same definition. See{' '}
              <Link href="/clickhouse-api" className={inlineLink}>
                ClickHouse REST API
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>AI chat over customer data</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              <code className={inlineCode}>@hypequery/mcp</code> exposes datasets and named metrics to agents as tools.
              The agent never writes raw SQL, and a server for tenant-scoped datasets will not start without a tenant.
              See{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                ClickHouse MCP
              </Link>
              .
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Where it fits"
        title="When hypequery is the wrong choice"
        intro={
          <>
            <p>
              hypequery is infrastructure for engineers, not a dashboard product. It is the wrong choice when:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>Your data is in Postgres, BigQuery or Snowflake. hypequery is ClickHouse-only today.</li>
              <li>
                Non-engineers need to build and change customer dashboards in a drag-and-drop editor. Embedded BI tools
                do that; the{' '}
                <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
                  embedded analytics platforms comparison
                </Link>{' '}
                covers them.
              </li>
              <li>Customers expect to explore data freely, building their own charts and queries.</li>
              <li>You have no front-end time to build chart components.</li>
            </ul>
          </>
        }
      />

      <HubSection
        eyebrow="Adoption"
        title="Open source and built in public"
        intro={
          <p>
            The hypequery libraries are Apache 2.0 and developed in the open on GitHub. These numbers are fetched from
            npm and GitHub when the page is built:
          </p>
        }
      >
        <dl className="grid max-w-[760px] gap-5 sm:grid-cols-2">
          <div className={marketing.card}>
            <dt className="font-mono text-xs text-text-dim">npm downloads, last 30 days</dt>
            <dd className="mt-2 text-2xl font-medium tracking-tight text-text">
              {monthlyDownloads !== null ? new Intl.NumberFormat('en').format(monthlyDownloads) : (
                <a href="https://www.npmjs.com/org/hypequery" className={inlineLink}>See npm</a>
              )}
            </dd>
            <dd className="mt-1 text-xs text-text-dim">@hypequery/clickhouse and @hypequery/datasets combined</dd>
          </div>
          <div className={marketing.card}>
            <dt className="font-mono text-xs text-text-dim">GitHub stars</dt>
            <dd className="mt-2 text-2xl font-medium tracking-tight text-text">
              {stars !== null ? new Intl.NumberFormat('en').format(stars) : (
                <a href="https://github.com/hypequery/hypequery" className={inlineLink}>See GitHub</a>
              )}
            </dd>
            <dd className="mt-1 text-xs text-text-dim">
              <a href="https://github.com/hypequery/hypequery" className="hover:text-accent">
                github.com/hypequery/hypequery
              </a>
            </dd>
          </div>
        </dl>
      </HubSection>

      <HubSection band eyebrow="Questions" title="Embedded analytics for SaaS: FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection eyebrow="Keep reading" title="Guides, docs and comparisons">
        <HubLinkGrid links={nextLinks} />
      </HubSection>

      <section className={`${marketing.container} pb-20`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
              Put one customer-facing metric behind a tenant key
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define one dataset over a table you already have, serve it, and render it with a hook. Want it hosted
              instead?{' '}
              <DeployWaitlist location="saas-analytics-next-step" className={inlineLink} />
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/docs/quick-start"
              data-umami-event="cta_click"
              data-umami-event-target="docs_quick_start"
              data-umami-event-location="hub_next_step_primary"
              className={marketing.primaryButton}
            >
              Get started <span aria-hidden="true">→</span>
            </Link>
            <Link href="/docs/datasets/multi-tenancy" className={marketing.secondaryButton}>
              Multi-tenancy docs
            </Link>
          </div>
        </div>
      </section>
    </HubShell>
  );
}
