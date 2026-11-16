import type { Metadata } from 'next';
import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/compare/build-vs-buy-embedded-analytics';
const TITLE = 'Build vs Buy Embedded Analytics (2026): Costs, Risks and a Third Option';
const DESCRIPTION =
  'Should you build embedded analytics in-house or buy a platform? What each part really costs (data model, tenant isolation, caching, APIs, charts, AI agents), when each choice wins, and the middle path: an open-source data layer with your own front end.';
const PUBLISHED = '2026-11-14';
const UPDATED = updatedFor(PATH);
const VERIFIED_ON = 'November 14, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('Build vs buy embedded analytics'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';

const pathsRows = [
  [
    'Build everything',
    'Your own queries, API, tenant filters, caching and charts.',
    'Full control, no vendor bill, nothing to fit around.',
    'You own every part, including the parts that are easy to get wrong: tenant isolation, cache scoping and metric consistency.',
  ],
  [
    'Buy a platform',
    'An embedded BI vendor: dashboards, a builder, embedding by iframe, web component or SDK, and tenancy features.',
    'Fastest route to dashboards customers can see. Some include self-service editing and AI chat.',
    'Per-viewer or tier pricing, a look that is hard to make fully native, and a second copy of your metric logic.',
  ],
  [
    'Adopt a data layer, build the UI',
    'A semantic layer for the definitions, tenant rules, caching and APIs; your engineers build the screens.',
    'Native UI, one definition for app, API and agents, and no rebuild of the hard backend parts.',
    'You still build and maintain charts. The layer is a dependency you have to learn.',
  ],
];

const costRows = [
  [
    'Metric definitions',
    'One place that says what revenue, active users or churn mean, used by every chart and endpoint.',
    'Small at first. Grows with every new metric, and drifts when two queries define the same metric differently.',
  ],
  [
    'Tenant isolation',
    'Every query limited to one customer’s rows, with the tenant taken from a verified session.',
    'The highest-stakes part. One missing filter is a data leak, so it needs to be enforced in one place and tested.',
  ],
  [
    'Auth and embed tokens',
    'Short-lived signed tokens for the browser, verified on every request.',
    'Moderate. Usually reuses your app’s auth.',
  ],
  [
    'Query API',
    'Endpoints for each chart, with validated inputs, pagination and limits.',
    'Grows linearly with charts unless queries are generated from a model.',
  ],
  [
    'Caching and performance',
    'Fast repeated queries without serving one tenant’s cached result to another.',
    'Easy to add, easy to get wrong: the cache key must include the tenant.',
  ],
  [
    'Charts and dashboards',
    'The part customers see: charts, filters, date pickers, exports.',
    'Large but familiar front-end work. Chart libraries do much of it.',
  ],
  [
    'Self-service',
    'Customers building their own reports.',
    'Expensive to build well. The strongest reason to buy a platform.',
  ],
  [
    'AI agent access',
    'Letting an agent answer customers’ data questions.',
    'Text-to-SQL is quick to demo and hard to make safe. Needs the same definitions and tenant rules as the dashboards.',
  ],
];

const decideRows = [
  [
    'Build',
    'Analytics is a few fixed charts; one tenant or internal users only; you have no plans for customer self-service or agents.',
  ],
  [
    'Buy a platform',
    'You need customer-built reports or a dashboard editor soon; you have little front-end capacity; a vendor look and per-viewer pricing are acceptable.',
  ],
  [
    'Data layer plus your UI',
    'Analytics is part of the product and must look native; you have many tenants; the same numbers must feed your API, app and AI agents.',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'Should I build or buy embedded analytics?',
    answer:
      'Buy a platform if customers need to build their own reports soon or you have little front-end capacity. Build if analytics is a few fixed charts for one audience. If analytics is a core part of your product, the usual middle path is to adopt a data layer for definitions, tenant isolation and APIs, and build the charts yourself.',
  },
  {
    question: 'What is the hardest part of building embedded analytics?',
    answer:
      'Not the charts. The hard parts are tenant isolation that cannot be bypassed, metric definitions that stay consistent as the number of charts grows, and caching that never crosses tenants. They are also the parts where a mistake is a security incident rather than a bug.',
  },
  {
    question: 'Can I buy the backend and build my own front end?',
    answer:
      'Yes. That is what headless or code-first tools do. Cube runs as a separate semantic layer service with REST, GraphQL and SQL APIs. hypequery is an open-source library in your own backend that serves a typed HTTP API, React hooks and an MCP server. In both, your team builds the UI.',
  },
  {
    question: 'How long does it take to build embedded analytics in-house?',
    answer:
      'A first chart behind your existing auth can take days. Production-ready multi-tenant analytics, with consistent metrics, enforced tenant isolation, caching, exports and tests, is a much larger project, and maintenance never ends. Estimate each part on this page separately rather than the whole.',
  },
  {
    question: 'Does buying a platform mean giving up control of the UI?',
    answer:
      'Partly. Platforms embedded by iframe have their own look, even when themed. Platforms with component SDKs come closer to native. Headless tools leave the whole UI to you, which is full control and full front-end work.',
  },
  {
    question: 'How does hypequery fit into build vs buy?',
    answer:
      'hypequery covers the backend half of building: datasets with measures and a tenant key, a typed HTTP API, React hooks, tenant-scoped caching and an MCP server, all open source and run in your own app against ClickHouse. It has no chart components or dashboard builder, so the front end is yours to build.',
  },
];

const sources = [
  {
    vendor: 'hypequery',
    urls: [
      'https://hypequery.com/docs/datasets/multi-tenancy',
      'https://hypequery.com/docs/authentication',
      'https://hypequery.com/docs/datasets/caching',
      'https://github.com/hypequery/hypequery',
    ],
  },
  {
    vendor: 'Cube',
    urls: ['https://github.com/cube-js/cube/blob/master/docs-mintlify/reference/core-data-apis/sql-api/index.mdx'],
  },
];

export default function BuildVsBuyEmbeddedAnalyticsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Build vs buy embedded analytics' },
      ]}
      eyebrow="Embedded analytics"
      title="Build vs buy embedded analytics"
      updated={UPDATED}
      lead={
        <p>
          Building looks cheap because the first chart is quick. Buying looks safe because the demo is polished. This
          guide breaks embedded analytics into its parts, says which ones are expensive to build, and covers the third
          option most product teams end up with.
        </p>
      }
      primaryCta={{ href: '#paths', label: 'The three paths', target: 'build_buy_paths' }}
      secondaryCta={{ href: '#decide', label: 'Decide', target: 'build_buy_decide' }}
      definition={{
        term: 'What does build vs buy mean for embedded analytics?',
        body: (
          <>
            <p>
              Embedded analytics puts charts, reports or AI answers inside your own product, scoped to each customer.
              Building means your team writes the queries, API, tenant rules and charts. Buying means an embedded
              analytics platform provides dashboards and embedding, and you configure it.
            </p>
            <p>
              Between the two sits a third path: adopt an open-source or hosted data layer for the hard backend parts,
              definitions, tenant isolation, caching and APIs, and build only the screens.
            </p>
          </>
        ),
      }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection id="paths" eyebrow="The options" title="Three ways to ship embedded analytics">
        <HubTable
          caption="Build, buy or adopt a data layer: what each path involves"
          columns={['Path', 'What you get', 'Strengths', 'Costs and risks']}
          rows={pathsRows}
        />
      </HubSection>

      <HubSection
        id="costs"
        band
        eyebrow="What it really costs"
        title="The parts of embedded analytics, and which are expensive"
        intro={
          <p>
            Estimate each part on its own. Teams that underestimate building usually priced the charts and forgot the
            rows below and above them.
          </p>
        }
      >
        <HubTable
          caption="Components of embedded analytics and their cost to build"
          columns={['Part', 'What it is', 'Cost to build and keep']}
          rows={costRows}
        />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          For the security side in detail, including a pre-launch test list, see{' '}
          <Link href="/semantic-layer/access-control" className={inlineLink}>
            data access control in a semantic layer
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        id="buy"
        eyebrow="Buying"
        title="What to check before you buy a platform"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">Pricing at your scale.</strong> Per-viewer, per-tier and flat pricing
              diverge quickly as customers grow. Price your expected viewer count, not today&rsquo;s.
            </li>
            <li>
              <strong className="text-text">How tenancy is enforced.</strong> A filter set on the embed token by your
              server is safe; a filter the browser sets is not.
            </li>
            <li>
              <strong className="text-text">Where the metric logic lives.</strong> If the platform has its own model,
              your API and agents need a second copy, and the two drift.
            </li>
            <li>
              <strong className="text-text">Database support.</strong> Check that your database is supported natively
              and that the queries it generates suit it.
            </li>
            <li>
              <strong className="text-text">Leaving.</strong> Ask how dashboards and definitions export if you move
              off.
            </li>
          </ul>
        }
      >
        <p className="text-sm leading-6 text-text-muted">
          Twelve platforms are compared in{' '}
          <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
            best embedded analytics platforms
          </Link>
          , and their published prices in{' '}
          <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
            embedded analytics pricing
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        id="middle"
        band
        eyebrow="The third option"
        title="Adopt the data layer, build the screens"
        intro={
          <>
            <p>
              The expensive, risky parts of building are in the backend: definitions, tenant isolation, caching and
              the query API. The parts that make analytics feel like your product are in the front end. A semantic
              layer splits the work along that line.
            </p>
            <p>
              Cube does this as a separate service with REST, GraphQL and Postgres-wire SQL APIs. hypequery does it as
              an open-source library inside your own backend, for ClickHouse: datasets in TypeScript or Python, a tenant
              key that refuses unscoped queries, a typed HTTP API and React hooks for your charts, and an MCP server so
              agents use the same definitions.
            </p>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">What you no longer build</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              SQL per chart, tenant filters per query, cache keys, input validation and an agent tool layer.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">What you still build</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Charts, filters and layout in your own components. hypequery has no chart components or dashboard
              builder.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">What it costs</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              The libraries are Apache 2.0 and free. You pay for the ClickHouse and servers you already run, plus the
              front-end time.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm leading-6 text-text-muted">
          See{' '}
          <Link href="/clickhouse-saas-analytics" className={inlineLink}>
            embedded analytics for SaaS
          </Link>{' '}
          for a worked ClickHouse example.
        </p>
      </HubSection>

      <HubSection id="decide" eyebrow="Decide" title="Which path fits">
        <HubTable caption="When to build, buy or adopt a data layer" columns={['Choose', 'When']} rows={decideRows} />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          The paths combine. Some teams adopt a data layer for their own charts and agents, and add a platform later
          only for customer self-service. One shared definition keeps the numbers consistent either way.
        </p>
      </HubSection>

      <HubSection band eyebrow="Questions" title="Build vs buy embedded analytics FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />

      <section className={`${marketing.container} pb-20`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Build the screens, not the backend</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define ClickHouse datasets with a tenant key, then call them from React hooks, a typed API or an AI
              agent. Open source.
            </p>
          </div>
          <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
            <Link
              href="/docs/datasets/overview"
              data-umami-event="cta_click"
              data-umami-event-target="docs_datasets_overview"
              data-umami-event-location="build_buy_next_step"
              className={marketing.primaryButton}
            >
              Read the datasets docs <span aria-hidden="true">→</span>
            </Link>
            <Link href="/embedded-analytics" className={marketing.secondaryButton}>
              Embedded analytics
            </Link>
          </div>
        </div>
      </section>
    </HubShell>
  );
}
