import type { Metadata } from 'next';
import Link from 'next/link';
import CodeWindow from '@/components/CodeWindow';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

const PATH = '/compare/hypequery-vs-embeddable';
const TITLE = 'hypequery vs Embeddable for Embedded Analytics';
const DESCRIPTION =
  'Compare hypequery and Embeddable on data modelling, multi-tenancy, UI ownership, pricing, ClickHouse support and AI agents. See which fits your team.';
const PUBLISHED = '2026-11-12';
const UPDATED = updatedFor(PATH);
// Every Embeddable claim was checked on embeddable.com and docs.embeddable.com on this date. See seo-verification-log.md.
const VERIFIED_ON = 'November 12, 2026';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: TITLE,
    description: DESCRIPTION,
    images: ogImage('hypequery vs Embeddable'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

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

// Verbatim from https://docs.embeddable.com/data-modeling/row-level-security/sql-based-security
const embeddableCode = `cubes:
  - name: orders
    title: "Orders"
    sql: >
      SELECT * FROM public.orders
      WHERE org_id = '{ COMPILE_CONTEXT.securityContext.orgId }'
      AND user_id = { COMPILE_CONTEXT.securityContext.userId }`;

const glanceRows = [
  [
    'Data modelling',
    'TypeScript or Python datasets in your app repo',
    'Cube models (*.cube.yml) in a repo or the in-platform Data Model Editor',
  ],
  [
    'Supported databases',
    'ClickHouse only (Cloud, self-hosted, chDB)',
    'ClickHouse, Postgres, Snowflake, BigQuery, Databricks, Redshift, MySQL and more',
  ],
  [
    'Tenant isolation',
    'Tenant key per dataset; queries without a tenant fail',
    'Security context in a signed token, applied by security filters, SQL-based security or access policies',
  ],
  [
    'Front end',
    'You build it: typed hooks and endpoints, your own charts',
    'React components you register, assembled in a no-code builder or YAML, embedded as a web component',
  ],
  [
    'AI and MCP',
    'MCP server for datasets and metrics (released)',
    'AI endpoints in beta with an example MCP server; AI chatbot in prototype',
  ],
  [
    'Self-hosting',
    'Yes: libraries in your backend',
    'Hosted in US or EU regions; the Cube layer can be your own',
  ],
  ['Pricing model', 'Open source, free; hosted cloud not live yet', 'Flat monthly subscription, quote only'],
  ['Open source', 'Apache 2.0', 'Platform is commercial'],
];

const faqItems: FaqItem[] = [
  {
    question: 'Is Embeddable built on Cube?',
    answer:
      'Yes. Embeddable’s docs say its data models use Cube’s modelling language, written as *.cube.yml files. Embeddable runs a managed Cube deployment by default, and you can connect your own Cube Cloud or self-hosted Cube Core instead.',
  },
  {
    question: 'How much does Embeddable cost?',
    answer:
      'Embeddable does not publish prices. Its pricing page, checked November 12, 2026, describes a flat monthly subscription with unlimited usage and every feature, priced mainly on project scope rather than monthly active users, with a custom quote from sales.',
  },
  {
    question: 'Does Embeddable support ClickHouse?',
    answer:
      'Yes. Embeddable lists ClickHouse among its database connections, alongside Postgres, Snowflake, BigQuery, Databricks, Redshift, MySQL and others. hypequery supports only ClickHouse.',
  },
  {
    question: 'Does hypequery have a dashboard builder like Embeddable?',
    answer:
      'No. hypequery has no dashboard builder or chart components. It serves typed endpoints, React hooks and MCP tools, and your team builds the UI. Embeddable provides a no-code builder and a production component suite called Remarkable Pro.',
  },
  {
    question: 'Can I self-host Embeddable?',
    answer:
      'Embeddable’s docs describe hosting in US and EU regions. The data layer can be your own Cube Core or Cube Cloud instance, but self-hosting the Embeddable platform itself is not documented. hypequery runs entirely in your own backend.',
  },
];

const sources = [
  {
    vendor: 'Embeddable',
    urls: [
      'https://embeddable.com/pricing',
      'https://docs.embeddable.com/data-modeling/introduction',
      'https://docs.embeddable.com/data-modeling/row-level-security/sql-based-security',
      'https://docs.embeddable.com/data-modeling/row-level-security/access-policies',
      'https://docs.embeddable.com/data/bring-your-own-cube',
      'https://docs.embeddable.com/faq',
      'https://docs.embeddable.com/data/credentials',
      'https://docs.embeddable.com/component-libraries/build-components/define-component-function',
      'https://docs.embeddable.com/dashboards/introduction',
      'https://docs.embeddable.com/deployment/embedding',
      'https://docs.embeddable.com/deployment/deployment-regions',
      'https://docs.embeddable.com/self-serve/ai-endpoints',
      'https://docs.embeddable.com/self-serve/ai-chatbot',
    ],
  },
  { vendor: 'Luzmo', urls: ['https://www.luzmo.com/pricing'] },
  { vendor: 'Cube', urls: ['https://cube.dev/pricing'] },
  { vendor: 'GoodData', urls: ['https://www.gooddata.com/pricing/'] },
];

export default function HypequeryVsEmbeddablePage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'hypequery vs Embeddable' },
      ]}
      eyebrow="Compare"
      title="hypequery vs Embeddable"
      updated={UPDATED}
      lead={
        <p>
          The practical difference is who owns the dashboard. With Embeddable, engineers build React components and Cube
          models, then product or customer teams assemble dashboards in a no-code builder. With hypequery, engineers own
          the entire UI as well as the typed ClickHouse model behind it. Choose Embeddable for a ready-made dashboard
          workflow across several databases; choose hypequery when you want the whole analytics stack in your own app.
        </p>
      }
      primaryCta={{ href: '#at-a-glance', label: 'At a glance', target: 'vs_embeddable_table' }}
      secondaryCta={{ href: '/compare/embedded-analytics-platforms', label: 'All platforms', target: 'vs_embeddable_listicle' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection id="at-a-glance" eyebrow="At a glance" title="hypequery and Embeddable side by side">
        <HubTable
          caption={`hypequery and Embeddable compared, verified ${VERIFIED_ON}`}
          columns={['', 'hypequery', 'Embeddable']}
          rows={glanceRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Embeddable column verified against embeddable.com and docs.embeddable.com on {VERIFIED_ON}. hypequery is our
          product.
        </p>
      </HubSection>

      <HubSection
        band
        eyebrow="Data modelling"
        title="Where the data model lives"
        intro={
          <>
            <p>
              Embeddable’s{' '}
              <a href="https://docs.embeddable.com/data-modeling/introduction" rel="noopener nofollow" className={extLink}>
                data modelling docs
              </a>{' '}
              say that “under the hood, Embeddable uses a popular data modeling language called Cube.” Models are{' '}
              <code className={inlineCode}>*.cube.yml</code> files or built in its Data Model Editor. Embeddable runs a
              managed Cube by default; you can point it at your own Cube Cloud or self-hosted Cube Core instead. In
              practice, Cube’s syntax, joins and security context are what you learn, and Cube’s documentation applies.
            </p>
            <p>
              hypequery datasets are TypeScript (or Python) modules in your application repo. Your backend imports them, so
              a renamed measure breaks the type check for every caller in the same pull request.
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
            <p className="mb-3 font-mono text-xs text-text-dim">Embeddable: SQL-based security in a Cube model</p>
            <CodeWindow code={embeddableCode} filename="orders.cube.yml" language="yaml" />
            <p className="mt-3 text-xs leading-5 text-text-dim">
              Verbatim from{' '}
              <a href="https://docs.embeddable.com/data-modeling/row-level-security/sql-based-security" rel="noopener nofollow" className={extLink}>
                docs.embeddable.com/data-modeling/row-level-security/sql-based-security
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
              In Embeddable, your server asks the Tokens API for a security token and passes a security context, such as{' '}
              <code className={inlineCode}>{'{ "orgId": "acme" }'}</code>. The docs offer three ways to apply it: security
              filters, SQL-based security (above), and access policies on views, which add role-based row and member
              rules. Embeddable’s own docs note the trade-off of the SQL style: you “need to repeat the same security
              context filter in each one” of your models, and it “requires recompiling the model for every new security
              context.” Access policies are the reusable option.
            </p>
            <p>
              In hypequery, the tenant column is declared once per dataset. Serve reads the tenant from your auth result and
              refuses requests without one. Queries without tenant context throw, and callers cannot add their own filter
              on the tenant column. The rule is enforced in your process, next to the session it trusts. The{' '}
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
              Embeddable splits the work. Engineers write React components and register them with{' '}
              <code className={inlineCode}>defineComponent</code>; Embeddable also ships a production component suite,
              Remarkable Pro. Anyone can then assemble dashboards in the no-code builder, or as YAML in your repo
              (“Dashboards as Code”). The result is embedded with the{' '}
              <code className={inlineCode}>{'<em-beddable>'}</code> web component and a token, not an iframe. End users can
              build their own dashboards from your templates with Custom Canvas.
            </p>
            <p>
              hypequery stops at the data. <code className={inlineCode}>@hypequery/react</code> generates typed hooks for
              each endpoint, and you render with your design system. There is no builder, so every dashboard change is an
              engineering change. That is the point for some teams and a blocker for others.
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
              hypequery serves the same datasets as REST endpoints with an OpenAPI spec, so customers can pull numbers into
              their own tools, and as MCP tools through <code className={inlineCode}>@hypequery/mcp</code>, released and
              documented. An MCP server for tenant-scoped datasets refuses to start without a tenant. See{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                ClickHouse MCP
              </Link>
              .
            </p>
            <p>
              Embeddable’s AI work is earlier. Its{' '}
              <a href="https://docs.embeddable.com/self-serve/ai-endpoints" rel="noopener nofollow" className={extLink}>
                AI endpoints
              </a>{' '}
              are in beta and come with an example MCP server written in Python, and its AI chatbot component is marked
              “Prototype”. Its core output is embedded dashboards rather than a general data API.
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
              <strong className="text-text">Embeddable:</strong> custom pricing (contact sales). The{' '}
              <a href="https://embeddable.com/pricing" rel="noopener nofollow" className={extLink}>
                pricing page
              </a>{' '}
              describes “a flat monthly subscription - with unlimited usage, every feature”, priced on project scope rather
              than monthly active users or query volume, and white-labelled by default.
            </p>
            <p>
              <strong className="text-text">hypequery:</strong> the libraries are Apache 2.0 and free. You pay for the
              ClickHouse and servers you already run, plus the engineering time to build the UI. hypequery cloud is on a
              waitlist and has no price yet.
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
        title="When to choose Embeddable instead"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>Product managers or customer success should assemble and change dashboards without a deploy.</li>
            <li>Your data is in Postgres, Snowflake, BigQuery or another warehouse that hypequery does not support.</li>
            <li>You want end users to build their own dashboards from templates, which Custom Canvas provides.</li>
            <li>You want a vendor-maintained component suite rather than building charts in-house.</li>
            <li>A predictable flat subscription matters more to you than running everything in your own infrastructure.</li>
          </ul>
        }
      />

      <HubSection
        band
        eyebrow="Other options"
        title="Other Embeddable alternatives"
        intro={
          <>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-text">Luzmo</strong>: embedded BI with an embedded dashboard editor for end users;
                one published plan from €1,995 a month, billed annually. See{' '}
                <Link href="/compare/luzmo-alternatives" className={inlineLink}>
                  Luzmo alternatives
                </Link>
                .
              </li>
              <li>
                <strong className="text-text">Cube</strong>: the semantic layer Embeddable builds on, with its own embedded
                dashboards on the Premium plan. See{' '}
                <Link href="/cube-js-alternative" className={inlineLink}>
                  Cube alternatives
                </Link>
                .
              </li>
              <li>
                <strong className="text-text">GoodData</strong>: a hosted platform with workspace-based multi-tenancy and
                React, Web Component and iframe embedding; pricing on request.
              </li>
            </ul>
            <p>
              The full list, grouped by approach, is in{' '}
              <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
                the best embedded analytics platforms
              </Link>
              . For hypequery’s own approach end to end, see{' '}
              <Link href="/clickhouse-saas-analytics" className={inlineLink}>
                embedded analytics for SaaS on ClickHouse
              </Link>
              .
            </p>
          </>
        }
      />

      <HubSection eyebrow="Questions" title="hypequery vs Embeddable FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Try one tenant-scoped dataset</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Define a dataset over a ClickHouse table you already have and serve it from your backend in a few minutes.
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

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
