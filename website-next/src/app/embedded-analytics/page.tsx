import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubLinkGrid, HubSection, HubShell, HubTable, type HubLink } from '@/components/hub-page';
import { DeployWaitlist } from '@/components/home/DeployWaitlist';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { hubs } from '@/data/hubs';

const PATH = '/embedded-analytics';
const TITLE = 'Embedded Analytics for Developers: Build vs Buy';
const DESCRIPTION =
  'What embedded analytics is, when to embed a BI tool and when to build, how to isolate tenants on ClickHouse, and how 8 tools compare.';
// The date the vendor table was checked against each vendor's own site.
const VERIFIED_ON = 'November 8, 2026';

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

const inlineLink = 'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';

const tenantCode = `import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { db } from './client'; // your createQueryBuilder instance

export const Usage = dataset('usage', {
  source: 'usage_events',
  tenantKey: 'org_id', // every query is scoped to one customer
  timeKey: 'ts',
  dimensions: {
    feature: dimension.string(),
    day: dimension.timestamp({ column: 'ts' }),
  },
  measures: {
    events: measure.count('id'),
  },
});

const analytics = createDatasetClient({ queryBuilder: db });

// The tenant comes from your verified session, never from the request body.
// Leave it out and the query is rejected instead of returning every customer.
const rows = await analytics.execute(
  Usage,
  { dimensions: ['feature'], measures: ['events'] },
  { runtime: { tenant: { id: session.orgId } } },
);`;

const buildVsBuyRows = [
  ['Who draws the charts', 'The vendor. You pick chart types and theme them.', 'You, with your own components or a chart library.'],
  ['Time to first dashboard', 'Short: connect a database, build a dashboard, embed it.', 'Longer: you write the API, the components and the layout.'],
  ['Look and feel', 'Themeable within what the vendor exposes.', 'Whatever your design system already does.'],
  ['Where metrics are defined', 'In the vendor’s model or dashboard editor.', 'In your codebase, reviewed and versioned like other code.'],
  ['Tenant isolation', 'Signed embed tokens or row-level rules set in the vendor.', 'Enforced in your backend from the authenticated session.'],
  ['Self-serve exploration', 'Often included: filters, drill-down, sometimes a query editor.', 'Only what you build.'],
  ['Cost model', 'Platform fee, per user, per viewer or usage based.', 'Engineering time plus your database and hosting.'],
];

const vendorRows = [
  [
    'Metabase',
    'iframe (full app or guest embeds), web components, React SDK',
    'Partly: open source edition under AGPL; paid editions under a commercial license',
    'Yes',
    'Open source free. Starter $100/mo plus $6/user, Pro $575/mo plus $12/user, Enterprise from $20,000/yr',
  ],
  [
    'Luzmo',
    'Web components by default, iframe option, React, Vue and Angular components, Flex SDK for charts from code',
    'No',
    'Not by default; private deployments by arrangement on Enterprise',
    'From €1,995/mo billed annually, scaling with usage',
  ],
  [
    'Embeddable',
    'Web component, with guides for React, Next.js, Vue and Angular',
    'Partly: the Remarkable UI component library and CLI are MIT',
    'No: the platform is hosted; the Cube data layer it uses can run in your environment',
    'Quote on request; fixed price with unlimited usage',
  ],
  [
    'GoodData',
    'iframe, web components, React SDK (GoodData.UI), raw data from the JS and Python SDKs',
    'Partly: Python SDK is MIT; GoodData.UI is under a commercial license',
    'Enterprise only, on demand',
    'Professional: platform fee plus per workspace. Enterprise: custom. No public prices',
  ],
  [
    'Explo',
    'Web component, iframe',
    'Not stated',
    'Enterprise only (on-premise deployment)',
    'Pro from $1,995/mo; Enterprise on request',
  ],
  [
    'Sisense',
    'iframe, Embed SDK, Compose SDK (React, Angular, Vue, web components), REST API',
    'No: Compose SDK source is public under an end user license agreement',
    'Enterprise: your own cloud or on-prem',
    'No public prices: Enterprise through sales, Self-Serve free trial',
  ],
  [
    'Cube',
    'iframe and React Embed SDK (Premium and Enterprise plans), headless REST, GraphQL and SQL APIs',
    'Yes: Cube Core, Apache 2.0',
    'Yes (Cube Core)',
    'Free tier. Starter $40 and Premium $80 per developer per month. Enterprise custom',
  ],
  [
    'hypequery',
    'Headless: typed HTTP API and React hooks over your datasets; you render the charts',
    'Yes: Apache 2.0',
    'Yes: a library that runs in your own backend',
    'Open source, free. A hosted option is on a waitlist',
  ],
];

const sources: Array<{ vendor: string; urls: string[] }> = [
  {
    vendor: 'Metabase',
    urls: [
      'https://www.metabase.com/pricing/',
      'https://www.metabase.com/docs/latest/embedding/introduction',
      'https://github.com/metabase/metabase',
    ],
  },
  {
    vendor: 'Luzmo',
    urls: [
      'https://www.luzmo.com/pricing',
      'https://developer.luzmo.com/guide/embedding--component-api-reference',
      'https://developer.luzmo.com/',
      'https://www.luzmo.com/compare/metabase',
    ],
  },
  {
    vendor: 'Embeddable',
    urls: [
      'https://embeddable.com/pricing',
      'https://docs.embeddable.com/deployment/embedding',
      'https://embeddable.com/security',
      'https://github.com/embeddable-hq',
    ],
  },
  {
    vendor: 'GoodData',
    urls: [
      'https://www.gooddata.ai/pricing/',
      'https://www.gooddata.ai/docs/cloud/embed-visualizations/',
      'https://github.com/gooddata/gooddata-ui-sdk',
      'https://github.com/gooddata/gooddata-python-sdk',
    ],
  },
  {
    vendor: 'Explo',
    urls: ['https://www.explo.co/pricing-two-tier', 'https://docs.explo.co/embedding-documentation/web-component-vs-iframe'],
  },
  {
    vendor: 'Sisense',
    urls: [
      'https://www.sisense.com/pricing/',
      'https://developer.sisense.com/guides/choosing-an-integration.html',
      'https://github.com/sisense/compose-sdk-monorepo/blob/main/LICENSE.md',
    ],
  },
  {
    vendor: 'Cube',
    urls: ['https://cube.dev/pricing', 'https://docs.cube.dev/embedding', 'https://github.com/cube-js/cube'],
  },
];

const faqItems: FaqItem[] = [
  {
    question: 'What is embedded analytics?',
    answer:
      'Embedded analytics means showing charts, dashboards and reports inside your own product, to your own customers, scoped to their data. It differs from internal BI, where employees look at data across the whole company.',
  },
  {
    question: 'Should I embed a BI tool or build my own dashboards?',
    answer:
      'Embed a BI tool when you need many dashboards fast, want customers to explore data on their own, or have no frontend capacity. Build when analytics is part of the core product, needs to match your design system, or is served through an API as well as a UI.',
  },
  {
    question: 'How do I keep one customer from seeing another customer’s data?',
    answer:
      'Take the tenant from the authenticated session on the server, apply it to every query in one place, and reject queries that arrive without it. With a BI embed, that usually means a signed token carrying the tenant; with a code-first layer, it is a tenant key on the dataset.',
  },
  {
    question: 'Is ClickHouse a good database for embedded analytics?',
    answer:
      'ClickHouse suits customer-facing analytics because it aggregates large tables quickly. Put the tenant column first in the table’s sorting key so single-tenant queries read only that tenant’s granules, and pre-aggregate heavy dashboards with materialized views or projections.',
  },
  {
    question: 'What does embedded analytics cost?',
    answer:
      'In the table on this page, published starting prices run from free open source editions to about 2,000 a month (Luzmo from €1,995, Explo Pro from $1,995), and several vendors quote only on request. Building costs engineering time instead of license fees.',
  },
  {
    question: 'Which embedded analytics tools are open source?',
    answer:
      'Of the tools compared here, Metabase (AGPL open source edition), Cube (Cube Core, Apache 2.0) and hypequery (Apache 2.0) have open-source cores. Embeddable and GoodData publish parts of their SDKs under MIT.',
  },
];

const guides: HubLink[] = [
  {
    href: '/blog/embedded-analytics-clickhouse-multi-tenant-dashboards',
    title: 'Embedded analytics with ClickHouse',
    description: 'The long guide: isolation models, row policies, projections, quotas and a reference architecture.',
  },
  {
    href: '/clickhouse-multi-tenant-analytics',
    title: 'ClickHouse multi-tenant analytics',
    description: 'Tenant isolation for SaaS when ClickHouse powers customer-facing features.',
  },
  {
    href: '/clickhouse-saas-analytics',
    title: 'ClickHouse SaaS analytics',
    description: 'A multi-tenant analytics layer for SaaS products on ClickHouse.',
  },
  {
    href: '/clickhouse-dashboard',
    title: 'ClickHouse dashboard data layer',
    description: 'The API and data layer behind React and TypeScript dashboards.',
  },
  {
    href: '/clickhouse-react',
    title: 'ClickHouse with React',
    description: 'Typed hooks for dashboard components, built on TanStack Query.',
  },
  {
    href: '/use-cases/multi-tenant-saas',
    title: 'Multi-tenant SaaS use case',
    description: 'Customer-facing analytics with tenant scoping and role checks in one backend path.',
  },
  {
    href: '/blog/usage-based-billing-clickhouse-typescript',
    title: 'Usage-based billing on ClickHouse',
    description: 'Meter customer usage in ClickHouse and show it back to customers.',
  },
  {
    href: '/blog/power-bi-embedded-pricing',
    title: 'Power BI Embedded pricing',
    description: 'What A and F SKU capacity costs, who needs a license, and cheaper alternatives.',
  },
  {
    href: '/compare/hypequery-vs-metabase',
    title: 'hypequery vs Metabase',
    description: 'A BI tool you embed compared with a code-first layer you build on.',
  },
  {
    href: '/docs/datasets/multi-tenancy',
    title: 'Dataset multi-tenancy docs',
    description: 'How tenant keys work, why they fail closed, and how runtime tenant context is passed.',
  },
  {
    href: '/docs/multi-tenancy',
    title: 'Serve multi-tenancy docs',
    description: 'Extract the tenant from auth and require it on every HTTP request.',
  },
  {
    href: '/docs/python/multi-tenancy',
    title: 'Python multi-tenancy docs',
    description: 'The same tenant rules for FastAPI, Django and Flask backends.',
  },
  {
    href: '/docs/datasets/caching',
    title: 'Dataset caching docs',
    description: 'A semantic-query cache with a TTL, for dashboards that repeat the same queries.',
  },
];

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'TechArticle',
  headline: TITLE,
  description: DESCRIPTION,
  url: absoluteUrl(PATH).toString(),
  dateModified: '2026-11-08',
  author: { '@type': 'Organization', name: 'hypequery' },
  publisher: { '@type': 'Organization', name: 'hypequery', url: absoluteUrl('/').toString() },
};

export default function EmbeddedAnalyticsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Embedded analytics' }]}
      eyebrow="Embedded analytics"
      title="Embedded analytics for developers: build or buy"
      lead={
        <p>
          How to put customer-facing dashboards into your product: when embedding a BI tool is the right call, when to
          build on a code-first layer, how to keep tenants apart, and what eight tools offer today.
        </p>
      }
      primaryCta={{ href: '#build-vs-buy', label: 'Build vs buy', target: 'embedded_build_vs_buy' }}
      secondaryCta={{ href: '#vendors', label: 'Compare vendors', target: 'embedded_vendors' }}
      definition={{
        term: 'What is embedded analytics?',
        body: (
          <>
            <p>
              Embedded analytics is reporting that lives inside your own product: charts, dashboards and exports that
              your customers see in your app, each scoped to their own data. A usage page in a developer tool, a sales
              report in a store admin and a spend chart in a billing portal are all embedded analytics.
            </p>
            <p>
              It differs from internal BI in two ways. The audience is your customers, so every query must be limited
              to one tenant. And the charts are part of your product, so they have to load fast and look like the rest
              of your UI.
            </p>
          </>
        ),
      }}
      jsonLd={[articleJsonLd, faqJsonLd(faqItems)]}
    >
      <HubSection
        id="build-vs-buy"
        eyebrow="The main decision"
        title="Embed a BI tool, or build with your own components"
        intro={
          <>
            <p>
              <strong className="text-text">Embedding a BI tool</strong> means building dashboards in a vendor’s editor
              and placing them in your app with an iframe, a web component or the vendor’s SDK. The vendor runs the
              queries, draws the charts and handles filtering.
            </p>
            <p>
              <strong className="text-text">Building</strong> means your backend serves the numbers through an API and
              your frontend draws them with the components you already use. A code-first layer such as hypequery covers
              the backend half: metric definitions, tenant scoping, typed endpoints and React hooks. The charts are
              yours.
            </p>
          </>
        }
      >
        <HubTable
          caption="Embedding a BI tool compared with building on a code-first layer"
          columns={['', 'Embed a BI tool', 'Build on a code-first layer']}
          rows={buildVsBuyRows}
        />
      </HubSection>

      <HubSection
        band
        eyebrow="Tenant isolation"
        title="Every query scoped to one customer, enforced in one place"
        intro={
          <>
            <p>
              The bug that matters in embedded analytics is a missing tenant filter. If each query adds{' '}
              <code className="font-mono text-[0.92em] text-text">WHERE tenant_id = ?</code> by hand, the one that
              forgets it shows a customer someone else’s data. The fix is the same whichever route you take: read the
              tenant from the authenticated session on the server, apply it centrally, and reject queries that arrive
              without it.
            </p>
            <p>
              BI tools do this with signed embed tokens or row-level rules configured in the vendor. ClickHouse itself
              offers row policies (<code className="font-mono text-[0.92em] text-text">CREATE ROW POLICY</code>) and
              separate tables or databases per tenant; the{' '}
              <Link href="/blog/embedded-analytics-clickhouse-multi-tenant-dashboards" className={inlineLink}>
                ClickHouse embedded analytics guide
              </Link>{' '}
              compares those models. With hypequery, the tenant key is part of the dataset definition and execution
              fails closed when tenant context is missing.
            </p>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
          <CodeWindow code={tenantCode} filename="analytics/usage.ts" />
          <div className={marketing.card}>
            <h3 className={marketing.cardTitle}>What the backend guarantees</h3>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-text-muted">
              <li>The tenant filter is injected from runtime context, not written per query.</li>
              <li>A query against a tenant-scoped dataset without tenant context throws instead of running.</li>
              <li>Explicit filters on the tenant column are rejected, so callers cannot widen their own scope.</li>
              <li>
                Over HTTP, Serve extracts the tenant from your auth result and can require it on every request. See the{' '}
                <Link href="/docs/multi-tenancy" className={inlineLink}>
                  Serve multi-tenancy docs
                </Link>
                .
              </li>
            </ul>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Performance"
        title="Fast dashboards on ClickHouse"
        intro={
          <>
            <p>
              Customer dashboards run the same few queries for many tenants, so the table layout matters more than the
              tool on top. Three habits cover most of it.
            </p>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Lead the sorting key with the tenant</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              With <code className="font-mono text-[0.92em] text-text">ORDER BY (tenant_id, ts)</code>, ClickHouse uses the
              primary index to skip other tenants’ granules. On a 2 million row test table with 100 tenants, a
              one-tenant count read 4 of 245 granules; with <code className="font-mono text-[0.92em] text-text">ORDER BY ts</code>{' '}
              it read all 245.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Pre-aggregate the heavy charts</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Materialized views and projections move aggregation to insert time, so a dashboard reads daily rollups
              instead of raw events. The{' '}
              <Link href="/blog/a-guide-to-materialized-views-in-clickhouse" className={inlineLink}>
                materialized views guide
              </Link>{' '}
              covers the tradeoffs.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Cache and rate limit per tenant</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Dashboards repeat queries, and one large customer can crowd out the rest. Cache repeated results with a
              TTL and put limits on the API in front of ClickHouse. See{' '}
              <Link href="/docs/datasets/caching" className={inlineLink}>
                dataset caching
              </Link>{' '}
              and{' '}
              <Link href="/docs/rate-limiting" className={inlineLink}>
                rate limiting
              </Link>
              .
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        id="vendors"
        band
        eyebrow="Vendor comparison"
        title="Embedded analytics tools compared"
        intro={
          <p>
            How each tool gets analytics into your app, whether you can read and run the code yourself, and how it is
            priced. Each cell was checked against the vendor’s own site on {VERIFIED_ON}; prices change, so confirm on
            the vendor’s pricing page before you decide.
          </p>
        }
      >
        <HubTable
          caption={`Embedded analytics vendors compared, checked ${VERIFIED_ON}`}
          columns={['Tool', 'How it embeds', 'Open source', 'Self-host', 'Pricing (published)']}
          rows={vendorRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          All eight document a ClickHouse connection. Embeddable connects to databases through Cube. hypequery is listed
          last because it is ours.
        </p>
      </HubSection>

      <HubSection
        eyebrow="An honest answer"
        title="When a BI embed is the better choice"
        intro={
          <>
            <p>
              Building on a code-first layer is not always the right call. Embed a BI tool such as Metabase, Luzmo or
              GoodData when:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>You need many dashboards soon and have no frontend engineers to build them.</li>
              <li>Customers expect to explore data themselves: build their own charts, drill down, or write queries.</li>
              <li>Non-engineers on your team should be able to create and change customer dashboards without a deploy.</li>
              <li>Analytics is a reporting add-on rather than part of the product’s core experience.</li>
              <li>You already run that BI tool internally and the same models can serve customers.</li>
            </ul>
            <p>
              Build when the charts are part of the product, need to match your design system, are also served through
              an API or to AI agents, or when per-viewer pricing grows faster than your revenue per customer. Many teams
              start with an embed and move the most-used views into their own components later.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Embedded analytics FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection
        eyebrow="Guides"
        title="Embedded analytics guides and docs"
        intro={
          <p>
            Deeper reading on each part of an embedded analytics stack on ClickHouse. For the metric definitions behind
            the dashboards, see the{' '}
            <Link href={hubs.semanticLayer.href} className={inlineLink}>
              ClickHouse semantic layer
            </Link>
            ; for clients and SQL patterns, see{' '}
            <Link href={hubs.clickhouse.href} className={inlineLink}>
              ClickHouse for TypeScript and Python developers
            </Link>
            .
          </p>
        }
      >
        <HubLinkGrid links={guides} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <h2 className="text-lg font-medium text-text">Sources</h2>
        <p className="mt-2 text-sm text-text-muted">Vendor pages used for the comparison table, all fetched on {VERIFIED_ON}.</p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2">
          {sources.map((source) => (
            <div key={source.vendor}>
              <dt className="font-medium text-text">{source.vendor}</dt>
              {source.urls.map((url) => (
                <dd key={url} className="break-all text-text-muted">
                  <a href={url} rel="noopener nofollow" className="hover:text-accent">
                    {url.replace(/^https:\/\//, '')}
                  </a>
                </dd>
              ))}
            </div>
          ))}
        </dl>
      </section>

      <section className={`${marketing.container} pb-20`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Serve one tenant-scoped chart from your own backend</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define a dataset with a tenant key, serve it over HTTP and render it with a React hook. Open source, and it
              runs in your own backend. Want it hosted?{' '}
              <DeployWaitlist location="embedded-analytics-next-step" className="font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent" />
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
