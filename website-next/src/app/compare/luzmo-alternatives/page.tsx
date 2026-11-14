import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// Prices here repeat /compare/embedded-analytics-pricing. Re-verify both together, quarterly.
const PATH = '/compare/luzmo-alternatives';
const TITLE = 'Best Luzmo Alternatives for SaaS Teams (2026)';
const DESCRIPTION =
  'Compare Luzmo alternatives including Embeddable, Cube, Metabase and hypequery by pricing, multi-tenancy, UI ownership and ClickHouse support.';
const PUBLISHED = '2026-11-12';
const UPDATED = updatedFor(PATH);
const VERIFIED_ON = 'November 12, 2026';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
    images: ogImage('Luzmo alternatives'),
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

const tableRows = [
  ['Luzmo', 'Embedded BI: editor, dashboards, Flex SDK', '19 databases, including ClickHouse', 'Embed-token parameter overrides, or a connection per tenant', 'Platform fee plus usage, from €1,995/month (annual)', 'A complete white-labelled product on one plan'],
  ['hypequery', 'Semantic layer (library)', 'ClickHouse only', 'Tenant key per dataset; un-scoped queries fail', 'Open source, free', 'ClickHouse teams who build their own UI'],
  ['Embeddable', 'Your React components plus a no-code builder, on Cube', 'ClickHouse, Postgres, Snowflake, BigQuery and more', 'Security context in a token; filters or access policies', 'Flat subscription, custom pricing (contact sales)', 'Engineers build components, others build dashboards'],
  ['Cube', 'Semantic layer (service)', 'About 26 engines, including ClickHouse', 'JWT security context with queryRewrite', 'Per developer plus hourly infrastructure', 'One model over many databases'],
  ['Sigma', 'BI with secure embedding', 'ClickHouse in beta', 'JWT claims, row-level security, Sigma Tenants', 'Custom pricing (contact sales)', 'Customers who analyse, not just view'],
  ['GoodData', 'Embedded BI platform', '23 sources, including ClickHouse', 'A workspace per customer with data filters', 'Platform fee plus per workspace, custom pricing (contact sales)', 'Managed multi-tenant BI'],
  ['Metabase', 'BI with embedding', 'Built-in ClickHouse driver', 'Tenants with SSO, or locked parameters in a guest token', 'Free open source; Pro from $575/month plus $12/user', 'Low cost to start, self-hostable'],
];

const faqItems: FaqItem[] = [
  {
    question: 'How much does Luzmo cost?',
    answer:
      'Luzmo publishes one plan, Embedded Everywhere, from €1,995 a month billed annually, checked November 12, 2026. It includes 500 AI conversations and 100 million Warp rows a month, with extra Warp rows at €0.25 per million; some contracts scale on monthly active users instead. There is no smaller tier.',
  },
  {
    question: 'Is there an open-source alternative to Luzmo?',
    answer:
      'Yes. Metabase has an AGPL open-source edition that can embed dashboards, with a “Powered by Metabase” badge. Apache Superset is Apache 2.0 and embeds through guest tokens. hypequery and Cube Core are Apache 2.0 data layers you build your own dashboards on; hypequery supports ClickHouse only.',
  },
  {
    question: 'Who are Luzmo’s main competitors?',
    answer:
      'Luzmo’s own comparison page covers Embeddable, GoodData, Metabase, Omni, Sisense and ThoughtSpot in depth. For engineering teams who want to own the front end, Cube and hypequery are the code-first alternatives.',
  },
  {
    question: 'Does Luzmo support ClickHouse?',
    answer:
      'Yes. ClickHouse is one of 19 database integrations on Luzmo’s connect page. Of the alternatives here, hypequery, Embeddable, Cube, GoodData and Metabase also document ClickHouse support, and Sigma’s ClickHouse connector is in beta.',
  },
  {
    question: 'What is cheaper than Luzmo for embedded analytics?',
    answer:
      'On published list prices, Metabase Pro with view-only guest embeds is $575 a month regardless of viewer count, the smallest Microsoft Fabric capacity for Power BI embedding is about $262.80 a month, and Metabase open source, Apache Superset and hypequery have no licence fee. Each does less out of the box than Luzmo’s single plan.',
  },
];

const sources = [
  {
    vendor: 'Luzmo',
    urls: [
      'https://www.luzmo.com/pricing',
      'https://www.luzmo.com/connect',
      'https://www.luzmo.com/compare',
      'https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data',
      'https://developer.luzmo.com/guide/dashboard-embedding--embed-into-application',
      'https://developer.luzmo.com/guide/dashboard-embedding--embedded-dashboard-editor',
      'https://developer.luzmo.com/guide/flex--introduction',
      'https://developer.luzmo.com/guide/iq--introduction',
    ],
  },
  { vendor: 'Embeddable', urls: ['https://embeddable.com/pricing', 'https://docs.embeddable.com/data-modeling/introduction', 'https://docs.embeddable.com/data/credentials', 'https://docs.embeddable.com/dashboards/introduction'] },
  { vendor: 'Cube', urls: ['https://cube.dev/pricing', 'https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx'] },
  { vendor: 'Sigma', urls: ['https://www.sigmacomputing.com/pricing', 'https://help.sigmacomputing.com/docs/intro-to-embedded-analytics', 'https://help.sigmacomputing.com/docs/connect-to-clickhouse'] },
  { vendor: 'GoodData', urls: ['https://www.gooddata.ai/pricing/', 'https://www.gooddata.ai/docs/cloud/connect-data/', 'https://www.gooddata.ai/docs/cloud/workspaces/workspace-data-filters/'] },
  { vendor: 'Metabase', urls: ['https://www.metabase.com/pricing/', 'https://www.metabase.com/docs/latest/embedding/introduction', 'https://www.metabase.com/license'] },
  { vendor: 'Microsoft and Apache Superset', urls: ['https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/', 'https://www.npmjs.com/package/@superset-ui/embedded-sdk'] },
];

function Option({ name, children }: { name: string; children: ReactNode }) {
  return (
    <article className={marketing.card}>
      <h4 className="text-[17px] font-medium tracking-tight text-text">{name}</h4>
      <div className="mt-3 space-y-3 text-sm leading-6 text-text-muted">{children}</div>
    </article>
  );
}

function ReasonGroup({ id, reason, intro, children }: { id: string; reason: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24">
      <h3 className="text-2xl font-normal tracking-[-0.03em] text-text">“{reason}”</h3>
      <div className="mt-3 max-w-[760px] text-body text-text-muted">{intro}</div>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">{children}</div>
    </div>
  );
}

export default function LuzmoAlternativesPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Luzmo alternatives' },
      ]}
      eyebrow="Luzmo alternatives"
      title="The best Luzmo alternatives for SaaS teams"
      updated={UPDATED}
      lead={
        <p>
          Choose Embeddable when engineers should own the chart components but other teams need a dashboard builder.
          Choose Cube—or hypequery on ClickHouse—when you want a headless data layer and will build the UI yourself.
          Choose Sigma, GoodData or Metabase when customers need to explore data like analysts. If price is the reason
          you are leaving Luzmo, start with Metabase, Power BI Embedded or Apache Superset.
        </p>
      }
      primaryCta={{ href: '#compared', label: 'Compare options', target: 'luzmo_alt_table' }}
      secondaryCta={{ href: '/compare/embedded-analytics-pricing', label: 'Pricing compared', target: 'luzmo_alt_pricing' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Start here"
        title="Before switching: what Luzmo already includes"
        intro={
          <>
            <p>
              Luzmo is an embedded analytics platform. You connect a database (its{' '}
              <a href="https://www.luzmo.com/connect" rel="noopener nofollow" className={extLink}>
                connect page
              </a>{' '}
              lists 19, ClickHouse among them), build dashboards in its editor, and embed them with a web component or its
              React, React Native, Angular or Vue components. Your customers can get an embedded editor to build their own
              charts, developers can draw charts from code with the Flex SDK, and Luzmo IQ answers questions about the data
              with AI.
            </p>
            <p>
              Tenant isolation happens on the embed token. Your server creates an authorisation and sets{' '}
              <code className={inlineCode}>parameter_overrides</code> so a dataset-level filter is fixed to one customer,
              or uses <code className={inlineCode}>account_overrides</code> to point each customer at their own database.
            </p>
            <p>
              Pricing, from{' '}
              <a href="https://www.luzmo.com/pricing" rel="noopener nofollow" className={extLink}>
                luzmo.com/pricing
              </a>{' '}
              on {VERIFIED_ON}: one plan, Embedded Everywhere, from €1,995 a month, billed annually. There is no lower
              published tier. The plan includes white-label, self-service, AI and APIs, plus 500 AI conversations and 100
              million Warp rows a month. Extra Warp rows are €0.25 per million, and some contracts scale on monthly
              active users instead.
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="By reason for leaving"
        title="Luzmo alternatives grouped by the problem you want to fix"
      >
        <div className="space-y-14">
          <ReasonGroup
            id="own-the-front-end"
            reason="I want to own the front end and the code"
            intro={
              <p>
                Luzmo draws the charts. If your dashboards must match your design system exactly, or the same numbers have
                to reach an API and agents too, these move more of the stack into your hands.
              </p>
            }
          >
            <Option name="hypequery">
              <p>
                An open-source semantic layer for ClickHouse. Metrics, dimensions and a tenant key are TypeScript or Python
                in your repo; you get typed endpoints, React hooks and MCP tools, and you build the charts. hypequery is our
                product.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> ClickHouse only, and no editor of any kind.
              </p>
            </Option>
            <Option name="Embeddable">
              <p>
                Your engineers write the chart components in React and the data models in Cube YAML; anyone can then
                assemble dashboards in its no-code builder. Embeds are a web component, not an iframe.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> still a hosted platform, priced by quote. See{' '}
                <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
                  hypequery vs Embeddable
                </Link>
                .
              </p>
            </Option>
            <Option name="Cube">
              <p>
                An open-source semantic layer with REST, GraphQL and SQL APIs over about 26 engines. Build your UI on its
                APIs, or use Cube Cloud’s embedded dashboards on the Premium plan.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> another service to run or pay for. See{' '}
                <Link href="/cube-js-alternative" className={inlineLink}>
                  Cube alternatives
                </Link>
                .
              </p>
            </Option>
          </ReasonGroup>

          <ReasonGroup
            id="full-bi"
            reason="I need a full BI tool my customers can explore"
            intro={
              <p>
                Luzmo’s embedded editor lets customers build charts. If they need to slice, drill and query freely, as an
                analyst would, these BI-first tools go further.
              </p>
            }
          >
            <Option name="Sigma">
              <p>
                Secure embeds are one-time JWT-signed URLs generated on your server, with a React SDK. Tenancy comes from
                JWT claims, row-level security and Sigma Tenants, and an assistant and agents can be embedded too.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> pricing is not published, and ClickHouse support is in
                beta.
              </p>
            </Option>
            <Option name="GoodData">
              <p>
                Each customer gets a workspace that inherits a parent model, narrowed by workspace data filters. Embedding
                (iframe, Web Components, React SDK), SSO and white-labelling are on the Professional plan.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> a fee per workspace, with no published amounts.
              </p>
            </Option>
            <Option name="Metabase">
              <p>
                With SSO embedding on Pro or Enterprise, embedded users get drill-through, the query builder, the SQL editor
                and AI chat. Tenants keep each customer’s data apart.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> every SSO-embedded viewer is a billed user, at $12 a month
                each on Pro.
              </p>
            </Option>
          </ReasonGroup>

          <ReasonGroup
            id="cheaper"
            reason="I need it cheaper at scale"
            intro={
              <p>
                Luzmo’s floor is €1,995 a month, or €23,940 a year. These options publish prices below that. None includes
                everything Luzmo’s single plan does, so compare like for like. Prices verified {VERIFIED_ON}.
              </p>
            }
          >
            <Option name="Metabase">
              <p>
                Pro is $575 a month, and its view-only guest embeds don’t count viewers as users, so 1,000 viewers cost the
                same as 10. The open-source edition embeds for free with a “Powered by Metabase” badge.
              </p>
            </Option>
            <Option name="Power BI Embedded">
              <p>
                You pay for compute, not viewers. In East US, Fabric F2 works out at roughly $262.80 for a month of
                continuous running and an A1 node at roughly $735.91. When your app owns the data, viewers need no licence. Capacity must be sized for
                your load.
              </p>
            </Option>
            <Option name="Open source you host">
              <p>
                Apache Superset embeds through guest tokens carrying row-level security rules; hypequery and Cube Core give
                you the data layer for your own charts. No licence fee for any of them, but you pay in hosting and
                engineering time.
              </p>
            </Option>
          </ReasonGroup>
        </div>
        <p className="mt-10 max-w-[760px] text-sm leading-6 text-text-muted">
          The full arithmetic for 1,000 viewers across every vendor is in{' '}
          <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
            embedded analytics pricing compared
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        id="compared"
        eyebrow="Side by side"
        title="Luzmo and its alternatives compared"
        intro={<p>Checked against each vendor’s own site on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`Luzmo alternatives compared, verified ${VERIFIED_ON}`}
          columns={['Product', 'Approach', 'Data sources', 'Multi-tenancy', 'Pricing model', 'Best for']}
          rows={tableRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Verified on {VERIFIED_ON}. hypequery is our product. More platforms, grouped by architecture, are in{' '}
          <Link href="/compare/embedded-analytics-platforms" className={extLink}>
            the best embedded analytics platforms
          </Link>
          .
        </p>
      </HubSection>

      <HubSection
        band
        eyebrow="Our product"
        title="Where hypequery fits, honestly"
        intro={
          <>
            <p>
              hypequery suits a narrow case well: your data is in ClickHouse, your engineers want metrics and tenant rules
              as typed code reviewed in pull requests, and the same numbers must reach in-app dashboards, a customer API
              and AI agents. A missing tenant filter becomes an error rather than a leak, and it costs nothing in licence
              fees.
            </p>
            <p>
              It is not a fit if non-technical people need a drag-and-drop editor, if your customers expect to build their
              own reports, or if your data lives in Postgres, BigQuery or Snowflake today. In those cases one of the
              options above will serve you better. See{' '}
              <Link href="/clickhouse-saas-analytics" className={inlineLink}>
                embedded analytics for SaaS on ClickHouse
              </Link>{' '}
              for how it works.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Stay or switch?"
        title="When to stay on Luzmo"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              You use most of what the one plan includes: white-label, the embedded editor, AI answers and APIs. Nothing is
              held back for a higher tier.
            </li>
            <li>Your customers build their own charts in the embedded editor, and you don’t want to build that.</li>
            <li>You need mobile embedding; Luzmo ships a React Native component.</li>
            <li>Your data spans several of its 19 database integrations.</li>
            <li>Your product team, not your engineers, owns the dashboards.</li>
          </ul>
        }
      />

      <HubSection band eyebrow="Questions" title="Luzmo alternatives FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
