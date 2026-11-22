import type { Metadata } from 'next';
import { RelatedPages } from '@/components/related-pages';
import { softwareApplicationSchema } from '@/data/product';
import { compareRelatedLinks } from '@/data/related-pages';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/compare/hypequery-vs-luzmo';
const TITLE = 'hypequery vs Luzmo: Embedded Analytics Compared';
const DESCRIPTION =
  'hypequery vs Luzmo: where the data model lives, tenant isolation, who owns the UI, MCP and pricing. Hosted embedded BI or a semantic layer in your repo.';
const PUBLISHED = '2026-11-18';
const UPDATED = updatedFor(PATH);
// Every Luzmo claim was checked on luzmo.com and developer.luzmo.com on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 18, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('hypequery vs Luzmo'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

// Type-checked against @hypequery/datasets 0.30.0 and @hypequery/serve 0.25.0 (same snippet as /compare/hypequery-vs-embeddable).
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

// Verbatim from https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data
const luzmoCode = `import Luzmo from '@luzmo/nodejs-sdk';
const client = new Luzmo({
  api_key: '<your Luzmo API key>',
  api_token: '<your Luzmo API token>',
  host: 'https://api.luzmo.com'
});


const response = await client.create('authorization',
  {
    type: "embed",
    username: "<A unique and immutable identifier for your user>",
    name: "<user name>",
    email: "<user email>",
    suborganization: "<a suborganization name>",
    access: {
      collections: [

        {
          id: "<collection_id>",
          inheritRights: "use"
        }
      ]
    },
    parameter_overrides: {
      Country: [
        "Spain"
      ],
      <parameter name>: [
        "<value to apply>",
        "<other value to apply>"
      ],
      <parameter to clear>: {
        clear: true
      }
    }
  }
);`;

const glanceRows = [
  [
    'What it is',
    'Open-source semantic layer: libraries in your backend',
    'Hosted embedded analytics platform with a dashboard editor',
  ],
  [
    'Data modelling',
    'TypeScript or Python (beta) datasets in your app repo',
    'Datasets in Luzmo; metrics as formulas, derived columns or SQL views, also editable through its API',
  ],
  [
    'Supported databases',
    'ClickHouse only (Cloud, self-hosted, chDB)',
    '19 database integrations, ClickHouse among them',
  ],
  [
    'Tenant isolation',
    'Tenant key per dataset; queries without a tenant fail',
    'Embed token sets parameter_overrides on a dataset filter, or account_overrides for a database per customer',
  ],
  [
    'Front end',
    'You build it: typed endpoints and React hooks, your own charts',
    'Dashboards built in Luzmo, embedded with a web component or React, React Native, Angular and Vue components',
  ],
  [
    'Editing by your customers',
    'None',
    'Embedded dashboard editor (editLimited and editFull modes)',
  ],
  [
    'Charts from code',
    'Your chart library',
    'Flex SDK',
  ],
  [
    'AI and MCP',
    'MCP server over your datasets and metrics, run in your backend',
    'Luzmo IQ chat and answer components; hosted MCP server',
  ],
  [
    'Where it runs',
    'Your infrastructure; hypequery cloud is in early access',
    'Luzmo’s EU or US hosts, or a VPC; private infrastructure on enterprise contracts',
  ],
  ['Pricing', 'Open source, free; no published cloud price', 'From €1,995 a month, billed annually'],
  ['Open source', 'Apache 2.0', 'Commercial'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is the difference between hypequery and Luzmo?',
    answer:
      'Luzmo is a hosted embedded analytics platform. You connect a database, build dashboards in its editor and embed them in your app with its components. hypequery is an open-source semantic layer for ClickHouse that lives in your codebase. It serves typed endpoints, React hooks and MCP tools, and your team builds the charts.',
  },
  {
    question: 'Does Luzmo support ClickHouse?',
    answer:
      'Yes. ClickHouse is one of 19 database integrations on Luzmo’s connect page, and Luzmo’s multi-tenant guide lists ClickHouse among the connections whose credentials can be swapped per customer with account_overrides. hypequery supports only ClickHouse.',
  },
  {
    question: 'How much does Luzmo cost compared with hypequery?',
    answer:
      'Luzmo publishes one plan, Embedded Everywhere, from €1,995 a month billed annually, checked November 18, 2026. It includes 500 AI conversations and 100 million Warp rows a month, and extra Warp rows cost €0.25 per million. hypequery’s libraries are Apache 2.0 and free; hypequery cloud is in early access with no published price.',
  },
  {
    question: 'Does hypequery have a dashboard editor like Luzmo?',
    answer:
      'No. hypequery has no dashboard editor and no chart components. Luzmo lets your customers create and change dashboards inside your app through its embedded editor. If your customers expect to build their own reports, Luzmo covers that and hypequery does not.',
  },
  {
    question: 'Does Luzmo have an MCP server?',
    answer:
      'Yes. Luzmo hosts an MCP server that gives AI agents access to Luzmo IQ, with EU, US and VPC endpoints. Its docs say to authenticate with an embed token per end user so each user reaches only their own data. hypequery’s MCP server runs in your backend over the datasets in your repo.',
  },
  {
    question: 'Can I keep Luzmo metric definitions in git?',
    answer:
      'Luzmo’s semantic layer page says metrics live as a formula, a derived column or a SQL view, and that definitions can be created and maintained through its API, so you can script them. The page does not describe a file-based workflow. hypequery datasets are source files, so they go through pull requests like the rest of your app.',
  },
];

const sources = [
  {
    vendor: 'Luzmo',
    urls: [
      'https://www.luzmo.com/pricing',
      'https://www.luzmo.com/connect',
      'https://www.luzmo.com/semantic-layer',
      'https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data',
      'https://developer.luzmo.com/guide/dashboard-embedding--embed-into-application',
      'https://developer.luzmo.com/guide/dashboard-embedding--embedded-dashboard-editor',
      'https://developer.luzmo.com/guide/flex--introduction',
      'https://developer.luzmo.com/guide/iq--introduction',
      'https://developer.luzmo.com/guide/mcp--introduction',
    ],
  },
];

export default function HypequeryVsLuzmoPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'hypequery vs Luzmo' },
      ]}
      eyebrow="Compare"
      title="hypequery vs Luzmo"
      updated={UPDATED}
      lead={
        <p>
          Luzmo is hosted embedded BI. You connect one of its 19 supported databases, build dashboards in its editor and
          embed them with its components. hypequery is an open-source semantic layer that lives in your app repo. You
          define ClickHouse datasets in TypeScript or Python, review them in pull requests, and serve them as typed
          endpoints, React hooks and MCP tools while your team builds the UI. Choose Luzmo when product teams or customers
          need a ready-made dashboard editor; choose hypequery when your data is in ClickHouse and you want analytics
          versioned with your code.
        </p>
      }
      primaryCta={{ href: '#at-a-glance', label: 'At a glance', target: 'vs_luzmo_table' }}
      secondaryCta={{ href: '/compare/luzmo-alternatives', label: 'Luzmo alternatives', target: 'vs_luzmo_alternatives' }}
      jsonLd={[
        { '@context': 'https://schema.org', ...softwareApplicationSchema },
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection id="at-a-glance" eyebrow="At a glance" title="hypequery and Luzmo side by side">
        <HubTable
          caption={`hypequery and Luzmo compared, verified ${VERIFIED_ON}`}
          columns={['', 'hypequery', 'Luzmo']}
          rows={glanceRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Luzmo column verified against luzmo.com and developer.luzmo.com on {VERIFIED_ON}. hypequery is our product.
        </p>
      </HubSection>

      <HubSection
        band
        eyebrow="Data modelling"
        title="Where the data model lives"
        intro={
          <>
            <p>
              In Luzmo, the model sits inside the platform. Its{' '}
              <a href="https://www.luzmo.com/semantic-layer" rel="noopener nofollow" className={extLink}>
                semantic layer page
              </a>{' '}
              says “a metric lives in exactly one place, as a formula, a derived column or a SQL view”, and that
              definitions can be created and maintained through the API. It also says there is no dbt or Cube connector,
              so metrics defined elsewhere have to be written again in Luzmo.
            </p>
            <p>
              hypequery datasets are TypeScript (or Python) modules in your application repo. Your backend imports them,
              so a renamed measure breaks the type check for every caller in the same pull request, and the history of a
              metric is your git history. Because hypequery targets only ClickHouse, the query layer can compile straight
              to ClickHouse SQL, without a translation layer for other engines.
            </p>
          </>
        }
      >
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <div>
            <p className="mb-3 font-mono text-xs text-text-dim">hypequery: a dataset with a tenant rule</p>
            <CodeWindow code={hypequeryCode} filename="analytics/orders.ts" />
          </div>
          <div>
            <p className="mb-3 font-mono text-xs text-text-dim">Luzmo: an embed token with a parameter override</p>
            <CodeWindow code={luzmoCode} filename="server.js" language="javascript" />
            <p className="mt-3 text-xs leading-5 text-text-dim">
              Verbatim from{' '}
              <a
                href="https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data"
                rel="noopener nofollow"
                className={extLink}
              >
                developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data
              </a>
              , {VERIFIED_ON}.
            </p>
          </div>
        </div>
      </HubSection>

      <HubSection
        eyebrow="Multi-tenancy"
        title="How each keeps customers apart"
        intro={
          <>
            <p>
              Luzmo applies tenancy when your server creates an embed token. For one shared dataset, you add a parameter
              filter and set its value per user with <code className={inlineCode}>parameter_overrides</code>, as in the
              sample above. If each customer has their own database, <code className={inlineCode}>account_overrides</code>{' '}
              swaps the host, user and password per token. The{' '}
              <a
                href="https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data"
                rel="noopener nofollow"
                className={extLink}
              >
                multi-tenant guide
              </a>{' '}
              tells you to put the filter on the dataset, because a user with “use” access to a dashboard can duplicate
              or modify it and remove a dashboard-level filter.
            </p>
            <p>
              In hypequery, the tenant column is declared once per dataset. Serve reads the tenant from your auth result
              and refuses requests without one. Queries without tenant context throw, and callers cannot add their own
              filter on the tenant column. The{' '}
              <Link href="/docs/datasets/multi-tenancy" className={inlineLink}>
                multi-tenancy docs
              </Link>{' '}
              cover admin scopes across several tenants.
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="Front end"
        title="Who owns the UI"
        intro={
          <>
            <p>
              Luzmo draws the charts. You design dashboards in Luzmo and embed them with its web component or its React,
              React Native, Angular or Vue components, passing the key and token from your backend. With the embedded
              editor, your customers can create and change dashboards inside your app. The{' '}
              <code className={inlineCode}>editLimited</code> and <code className={inlineCode}>editFull</code> modes
              need a designer or owner role on the token. Developers who want charts placed from code can use the Flex
              SDK, which Luzmo describes as a way to “create customizable visualizations fully from code”.
            </p>
            <p>
              hypequery stops at the data. <code className={inlineCode}>@hypequery/react</code> generates typed hooks
              for each endpoint, and you render with your design system and chart library. There is no editor, so every
              dashboard change goes through engineering. Some teams want exactly that; for others it rules hypequery out.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Beyond dashboards"
        title="APIs, agents and MCP"
        intro={
          <>
            <p>
              Luzmo’s AI layer is Luzmo IQ, which it says can “generate AI-powered answers to data-related questions”,
              embedded as a chat component or an answer component. Luzmo also{' '}
              <a href="https://developer.luzmo.com/guide/mcp--introduction" rel="noopener nofollow" className={extLink}>
                hosts an MCP server
              </a>{' '}
              with EU, US and VPC endpoints. With an embed token per end user, the default tools are{' '}
              <code className={inlineCode}>search_datasets</code>, <code className={inlineCode}>answer_question</code> and{' '}
              <code className={inlineCode}>create_chart</code>.
            </p>
            <p>
              hypequery serves the same datasets as REST endpoints with an OpenAPI spec, so customers can pull numbers into
              their own tools, and as MCP tools through <code className={inlineCode}>@hypequery/mcp</code>. The MCP server
              runs in your process against your ClickHouse, and one over tenant-scoped datasets refuses to start without
              a tenant. See{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                ClickHouse MCP
              </Link>
              .
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="Pricing"
        title="What each costs"
        intro={
          <>
            <p>
              <strong className="text-text">Luzmo:</strong> one plan, Embedded Everywhere, from €1,995 a month, billed
              annually, per the{' '}
              <a href="https://www.luzmo.com/pricing" rel="noopener nofollow" className={extLink}>
                pricing page
              </a>
              . The page says “nothing is reserved for a higher plan”, and white-label, self-service, AI and APIs are all included.
              The licence includes 500 AI conversations and 100 million Warp rows a month; extra Warp rows are €0.25 per
              million, and some contracts scale on monthly active users instead. A free trial is available.
            </p>
            <p>
              <strong className="text-text">hypequery:</strong> the libraries are Apache 2.0 and free. You pay for the
              ClickHouse and servers you already run, plus the engineering time to build the UI. hypequery cloud, the
              hosted option, is in early access with no published price.
            </p>
            <p>
              Verified {VERIFIED_ON}. For every vendor side by side, see{' '}
              <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
                embedded analytics pricing compared
              </Link>
              .
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Best fit"
        title="When to choose Luzmo instead"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>Product or customer teams should build and change dashboards without an engineering release.</li>
            <li>Your customers expect to make their own dashboards, which the embedded editor provides.</li>
            <li>Your data is in Postgres, Snowflake, BigQuery or another of Luzmo’s 19 databases that hypequery does not support.</li>
            <li>You want AI answers and a chat component out of the box, through Luzmo IQ.</li>
            <li>You need mobile embedding; Luzmo ships a React Native component.</li>
            <li>A hosted platform with one published plan suits you better than running analytics in your own backend.</li>
          </ul>
        }
      />

      <HubSection
        band
        eyebrow="Other options"
        title="Other ways to compare"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-text">Leaving Luzmo for another reason?</strong>{' '}
                <Link href="/compare/luzmo-alternatives" className={inlineLink}>
                  Luzmo alternatives
                </Link>{' '}
                groups the options by the reason teams switch (owning the front end, a full BI tool, or cost).
              </li>
              <li>
                <strong className="text-text">Embeddable</strong>: engineers write React components and Cube models,
                then others assemble dashboards in a no-code builder. See{' '}
                <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
                  hypequery vs Embeddable
                </Link>
                .
              </li>
              <li>
                <strong className="text-text">Choosing where ClickHouse runs?</strong> See{' '}
                <Link href="/compare/clickhouse-cloud-vs-tinybird" className={inlineLink}>
                  ClickHouse Cloud vs Tinybird
                </Link>
                .
              </li>
            </ul>
            <p>
              The full list, grouped by approach, is in{' '}
              <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
                the best embedded analytics platforms
              </Link>
              .{' '}
              If you are new to the category, start with{' '}
              <Link href="/embedded-analytics" className={inlineLink}>
                embedded analytics
              </Link>{' '}
              for developers: architecture, tenancy and the three kinds of tool.
            </p>
          </>
        }
      />

      <HubSection eyebrow="Questions" title="hypequery vs Luzmo FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Try one tenant-scoped dataset</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define a dataset over a ClickHouse table you already have and serve it from your backend.
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
          </div>
        </div>
      </section>

      <RelatedPages band title="Related comparisons and docs" pages={compareRelatedLinks(PATH)} />

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
