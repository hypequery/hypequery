import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import {
  SemanticLayerGuides,
  SemanticLayerNextStep,
  inlineCode,
  inlineLink,
  spokeArticleJsonLd,
  spokeBreadcrumbs,
  spokeMetadata,
} from '@/components/semantic-layer-parts';
import { marketing } from '@/components/ui/marketing';
import { faqJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/semantic-layer/headless-bi';
const TITLE = 'Headless BI vs Semantic Layer: Definition and Tools (2026)';
const DESCRIPTION =
  'Headless BI is a metrics layer served over APIs with no bundled UI. How it differs from a semantic layer, the three common architectures and who sells it.';
const UPDATED = updatedFor(PATH);
// Every vendor claim was checked on the vendor's own site, docs or repository on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 18, 2026';

export const metadata = spokeMetadata({ path: PATH, title: TITLE, description: DESCRIPTION });

// Type-checked against @hypequery/datasets 0.30.0 and @hypequery/serve 0.25.0.
const hypequeryCode = `import { dataset, dimension, measure } from '@hypequery/datasets';
import { initServe } from '@hypequery/serve';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'org_id', // added to every query, from the session
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    orders: measure.count('order_id'),
    revenue: measure.sum('amount'),
  },
});

const { serve } = initServe({
  auth: async ({ request }) => verifySession(request.headers.authorization),
  tenant: { extract: (auth) => auth?.orgId, required: true },
});

export const api = serve({ queryBuilder: db, datasets: { orders: Orders } });`;

const termRows = [
  [
    'What it names',
    'The definitions: metrics, dimensions, joins and access rules, written once',
    'A delivery model: those definitions served over APIs to any front end, with no UI of its own',
  ],
  [
    'The question it answers',
    'What does “revenue” mean, and who may see which rows?',
    'How does my app, notebook or agent get revenue without its own copy of the logic?',
  ],
  [
    'Can exist without the other?',
    'Yes. A BI tool can have a semantic layer that only its own dashboards use',
    'No. Every headless BI setup needs a semantic layer behind the API',
  ],
  [
    'Where you hear it',
    'Data engineering and modelling discussions',
    'Product and front-end discussions, especially embedded analytics',
  ],
];

const architectureRows = [
  [
    'BI tool with embedding',
    'The vendor: dashboards built in its editor, shown in an iframe or SDK component',
    'In the BI tool',
    'You need customer dashboards soon, and they can look like the vendor’s product',
    'Styling and interaction stop where the vendor’s components stop',
  ],
  [
    'Headless BI or a semantic layer plus your UI',
    'You: your own charts and React components, calling the layer’s API',
    'In the semantic layer',
    'Analytics is part of the product and must match the rest of it',
    'You build and maintain every chart, filter and export',
  ],
  [
    'Build from scratch',
    'You',
    'In SQL spread across your backend',
    'One or two fixed charts that rarely change',
    'Each new chart repeats the metric logic, and tenant filters are written by hand each time',
  ],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is headless BI?',
    answer:
      'Headless BI is a way of running business intelligence where metric definitions and access rules live in one backend layer and are served over APIs, with no dashboard UI bundled in. Any front end can query that layer, from your product’s own charts to a notebook, a spreadsheet or an AI agent. The “head”, the screen people look at, is yours to build.',
  },
  {
    question: 'What is the difference between headless BI and a semantic layer?',
    answer:
      'A semantic layer is the set of definitions, such as what revenue means, which tables join and which rows each user may see. Headless BI is the delivery model that exposes those definitions over APIs to front ends you choose. Every headless BI tool contains a semantic layer, but a semantic layer can also sit inside a single BI tool and serve only its dashboards. Embeddable puts it as architecture versus component.',
  },
  {
    question: 'What are examples of headless BI tools?',
    answer:
      'Cube described itself as a headless BI platform when it renamed from Cube.js in 2022, and now describes Cube Core as the headless foundation under its agentic analytics product. GoodData lists Headless BI under its product menu and offers Python, JavaScript and React SDKs. Embeddable is a front-end platform built to work with headless BI tools like Cube. hypequery is an open-source semantic layer for ClickHouse that serves typed endpoints, React hooks and MCP tools.',
  },
  {
    question: 'Is headless BI the same as embedded analytics?',
    answer:
      'No. Embedded analytics is the goal, meaning charts and reports inside your product for your customers. Headless BI is one way to get there, where you build the charts on top of a metrics API. The other common way is to embed a BI tool’s dashboards through an iframe or SDK.',
  },
  {
    question: 'When should I not use headless BI?',
    answer:
      'When nobody on the team wants to build and maintain charts, or when non-engineers need to create dashboards themselves. A hosted BI tool gives them a builder. Headless BI gives engineers a consistent API and leaves the screen to them.',
  },
  {
    question: 'Does headless BI work with AI agents?',
    answer:
      'Yes. An agent is one more front end. If the layer exposes its metrics as tools, for example over MCP, the agent asks for revenue by country by name instead of writing SQL, and gets the same number your dashboard shows.',
  },
];

const sources = [
  {
    vendor: 'Cube',
    urls: [
      'https://cube.dev/blog/headless-bi',
      'https://cube.dev/blog/cube-js-is-now-cube',
      'https://cube.dev/blog/cube-native-ai-bi-frontend',
      'https://docs.cube.dev/docs/introduction',
      'https://github.com/cube-js/cube/tree/master/docs-mintlify/admin/connect-to-data/data-sources',
    ],
  },
  {
    vendor: 'GoodData',
    urls: ['https://www.gooddata.ai/', 'https://www.gooddata.ai/resources/headless-bi-what-you-need-to-know/'],
  },
  {
    vendor: 'Embeddable',
    urls: ['https://embeddable.com/', 'https://embeddable.com/blog/headless-bi-vs-semantic-layer'],
  },
];

export default function HeadlessBiPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={spokeBreadcrumbs('Headless BI')}
      eyebrow="Semantic layer"
      title="Headless BI explained"
      updated={UPDATED}
      lead={
        <p>
          Headless BI separates the metric definitions from the screens that show them. This guide covers what the term
          means, where it overlaps with a semantic layer, the three ways teams usually put analytics in a product, which
          vendors describe themselves as headless BI, and where hypequery fits.
        </p>
      }
      primaryCta={{ href: '#vs-semantic-layer', label: 'Headless BI vs semantic layer', target: 'headless_bi_vs' }}
      secondaryCta={{ href: '#tools', label: 'Headless BI tools', target: 'headless_bi_tools' }}
      definition={{
        term: 'What is headless BI?',
        body: (
          <>
            <p>
              Headless BI is business intelligence without a bundled user interface. Metrics, dimensions and access
              rules are defined once in a backend layer and served over APIs, and any front end can query them, whether that is your
              product&rsquo;s charts, a notebook, a spreadsheet or an AI agent. The vendor supplies the data layer; the
              front end is yours.
            </p>
            <p>
              The name comes from headless CMS, where content is stored and served by API and each site renders it in
              its own way. In both cases the &ldquo;head&rdquo; is the part users see, and the point is that you can
              have many of them on one backend.
            </p>
          </>
        ),
      }}
      jsonLd={[spokeArticleJsonLd({ path: PATH, title: TITLE, description: DESCRIPTION, dateModified: UPDATED }), faqJsonLd(faqItems)]}
    >
      <HubSection
        id="vs-semantic-layer"
        eyebrow="The terms"
        title="Headless BI vs a semantic layer"
        intro={
          <>
            <p>
              The two terms are often used for the same products, and they do overlap. A{' '}
              <Link href="/semantic-layer" className={inlineLink}>
                semantic layer
              </Link>{' '}
              is the set of definitions. Revenue is the sum of <code className={inlineCode}>amount</code> on completed
              orders, each customer belongs to one tenant, and so on. Headless BI is what you get when that layer is served
              over APIs to front ends it does not control.
            </p>
            <p>
              Vendors draw the line in the same place. Embeddable&rsquo;s guide calls headless BI the architecture and
              the semantic layer one of its components. Cube&rsquo;s explainer says headless BI &ldquo;decouples
              governed business definitions from the presentation layers that use them&rdquo;. GoodData&rsquo;s 2022
              guide calls it an analytical backend that makes metric definitions available through APIs.
            </p>
            <p>
              So every headless BI tool has a semantic layer inside it, but not every semantic layer is headless. The
              model inside a traditional BI tool, which only that tool&rsquo;s dashboards can read, is a semantic layer
              with a head attached.
            </p>
          </>
        }
      >
        <HubTable
          caption="Semantic layer and headless BI compared"
          columns={['', 'Semantic layer', 'Headless BI']}
          rows={termRows}
        />
      </HubSection>

      <HubSection
        id="architectures"
        band
        eyebrow="Architectures"
        title="Three ways to put analytics in a product"
        intro={
          <p>
            Most teams end up with one of these. The real choice is who owns the screen and where the metric logic lives.
            For the costs over time, see{' '}
            <Link href="/compare/build-vs-buy-embedded-analytics" className={inlineLink}>
              build vs buy for embedded analytics
            </Link>
            .
          </p>
        }
      >
        <HubTable
          caption="Embedded BI, headless BI and building from scratch compared"
          columns={['', 'Who builds the UI', 'Where metrics live', 'Fits when', 'The cost']}
          rows={architectureRows}
        />
        <p className="mt-4 text-sm leading-6 text-text-muted">
          The middle row is headless BI. It keeps the part that is hard to get right, consistent metrics and tenant
          isolation, in one place, and gives up the ready-made dashboards of the first row. The{' '}
          <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
            embedded analytics platforms guide
          </Link>{' '}
          groups the vendors in each row.
        </p>
      </HubSection>

      <HubSection
        id="tools"
        eyebrow="Vendors"
        title="Headless BI tools"
        intro={
          <p>
            These vendors use the term on their own sites, checked {VERIFIED_ON}. We list how each one describes itself
            and leave out anything we could not confirm there.
          </p>
        }
      >
        <div className="grid gap-5 md:grid-cols-2">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Cube</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Cube described itself as &ldquo;the headless BI platform&rdquo; when it renamed from Cube.js in 2022, and its 2025
              frontend post notes that &ldquo;Headless BI&rdquo; was its website slogan in 2022. Today its docs call
              Cube &ldquo;the agentic analytics platform built on a semantic layer&rdquo;, with Cube Core as the
              open-source, self-hostable headless part. It serves SQL (Postgres-compatible), REST and GraphQL APIs,
              and its docs cover more than 25 data sources, ClickHouse among them. See{' '}
              <Link href="/cube-js-alternative" className={inlineLink}>
                Cube alternatives
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">GoodData</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              GoodData lists Headless BI in its product menu. Its 2022 guide says the platform enables headless BI
              through a semantic layer exposed to other tools over APIs and SDKs (Python, JavaScript and React), and
              that it goes further with multi-tenancy and its own self-service UI. Its home page now lists SQL, MCP,
              A2A and SDKs as ways to connect.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Embeddable</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Embeddable is the front-end half. Its guide says it is &ldquo;built from the ground up to work with
              headless BI tools like Cube.dev&rdquo;, and its data models are Cube models. Engineers write the
              components and product teams assemble dashboards. See{' '}
              <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
                hypequery vs Embeddable
              </Link>
              .
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">hypequery</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Our product. An open-source (Apache 2.0) semantic layer for ClickHouse, defined in TypeScript or Python in
              your application repo and served as HTTP endpoints with an OpenAPI spec, typed React hooks and MCP tools.
              No dashboard builder. The rest of this page covers it.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        id="hypequery"
        band
        eyebrow="Where hypequery sits"
        title="A headless semantic layer that lives in your repo"
        intro={
          <>
            <p>
              Cube and GoodData run as separate services, with their own model files and deploy cycles. hypequery
              puts the model in your application. A dataset is a typed TypeScript or Python module next to the code that
              uses it, so a change to how revenue is calculated shows up in the pull request diff, gets reviewed with
              the feature that needs it, and ships in the same deploy.
            </p>
            <p>
              The same definition is then served to every head. Your backend calls it in-process, other services call it
              over HTTP with an OpenAPI spec, your React app uses typed hooks, and agents query it through the{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                hypequery MCP server
              </Link>
              . The guide to a{' '}
              <Link href="/clickhouse-semantic-layer" className={inlineLink}>
                semantic layer for ClickHouse in TypeScript or Python
              </Link>{' '}
              goes into more detail.
            </p>
          </>
        }
      >
        <CodeWindow code={hypequeryCode} filename="analytics/api.ts" />
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Tenant scope in the model</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              A <code className={inlineCode}>tenantKey</code> on the dataset adds the tenant filter to every query,
              from the authenticated session. With <code className={inlineCode}>required: true</code>, a request
              without a tenant fails instead of returning every customer&rsquo;s rows.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Built for ClickHouse</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              It supports only ClickHouse, so measures map to ClickHouse functions. <code className={inlineCode}>approxCountDistinct</code>{' '}
              uses <code className={inlineCode}>uniq</code>, <code className={inlineCode}>argMax</code> is there, and{' '}
              <code className={inlineCode}>merge</code> reads aggregate states that a materialized view stored.
            </p>
          </div>
          <div className={marketing.card}>
            <h3 className="text-[17px] font-medium tracking-tight text-text">Runs on your laptop</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Point the same datasets at chDB, embedded ClickHouse, to develop and test with no server or credentials.
              In production it runs in your own backend. hypequery cloud, the hosted option, is in early access.
            </p>
          </div>
        </div>
        <p className="mt-6 text-sm leading-6 text-text-muted">
          Start with the{' '}
          <Link href="/docs/quick-start" className={inlineLink}>
            quick start
          </Link>
          , then the{' '}
          <Link href="/docs/datasets/overview" className={inlineLink}>
            datasets overview
          </Link>{' '}
          and{' '}
          <Link href="/docs/react/getting-started" className={inlineLink}>
            React hooks setup
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        eyebrow="Trade-offs"
        title="What you give up with headless BI"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                Your team builds the charts, filters, date pickers, exports and empty states, and rebuilds them each
                time the design changes.
              </li>
              <li>
                Non-engineers cannot build dashboards themselves. A hosted BI tool, or a platform like Embeddable, gives
                product and customer teams a builder. hypequery does not.
              </li>
              <li>
                hypequery supports only ClickHouse. If your metrics span Snowflake, Postgres and ClickHouse, Cube
                supports many more databases behind one model.
              </li>
              <li>
                The model lives in one application, so BI tools elsewhere in the company cannot read it the way they can
                read Cube&rsquo;s SQL API.
              </li>
            </ul>
            <p>
              Choose hypequery when the data is in ClickHouse, the analytics are part of your product, and your
              engineers want the metric definitions reviewed and deployed like the rest of the code.
            </p>
          </>
        }
      />

      <HubSection band eyebrow="Questions" title="Headless BI FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <SemanticLayerGuides currentHref={PATH} />
      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
      <SemanticLayerNextStep location="headless_bi_next_step" />
    </HubShell>
  );
}
