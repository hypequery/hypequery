import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// Prices here repeat /compare/embedded-analytics-pricing and /compare/luzmo-alternatives. Re-verify together, quarterly.
// Every third-party claim was checked on the vendor's own site on this date. See seo-verification-log.md.
const PATH = '/compare/embeddable-alternatives';
const TITLE = 'Embeddable Alternatives for SaaS Teams (2026)';
const DESCRIPTION =
  'Embeddable alternatives compared: hypequery, Cube, Luzmo, GoodData, Metabase, Superset and Tinybird by pricing, multi-tenancy, UI ownership and ClickHouse.';
const PUBLISHED = '2026-11-18';
const UPDATED = updatedFor(PATH);
const VERIFIED_ON = 'November 18, 2026';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
    images: ogImage('Embeddable alternatives'),
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const inlineCode = 'font-mono text-[0.92em] text-text';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

const tableRows = [
  ['Embeddable', 'React components you write plus a no-code builder, on Cube', '14 connection types, including ClickHouse', 'Security context in a token; security filters, SQL-based security or access policies', 'Flat monthly subscription, custom quote', 'Engineers build components, others assemble dashboards'],
  ['hypequery', 'Semantic layer library in your repo; you build the UI', 'ClickHouse only', 'Tenant key per dataset; queries without a tenant fail', 'Open source, free; hypequery cloud in early access, no price yet', 'ClickHouse teams who build their own UI'],
  ['Cube', 'Semantic layer with REST, GraphQL and SQL APIs; embedded dashboards on Premium', 'Many SQL sources, including ClickHouse', 'JWT security context with queryRewrite', 'Free plan; Starter $40 and Premium $80 per developer a month, plus hourly infrastructure', 'One model over many databases'],
  ['Luzmo', 'Embedded BI: dashboard editor, editor for your customers', '19 databases, including ClickHouse', 'Embed-token parameter overrides, or a connection per tenant', 'One plan from €1,995 a month, billed annually', 'A complete white-labelled product on one plan'],
  ['GoodData', 'Embedded BI platform', 'Many sources, including ClickHouse', 'A workspace per customer with workspace data filters', 'Platform fee plus per workspace, no published amounts', 'Managed multi-tenant BI'],
  ['Metabase', 'BI with embedding', 'Built-in ClickHouse driver', 'Tenants with SSO embedding; guest embeds are view-only', 'Open source free; Pro $575 a month plus $12 a user', 'Low cost to start, self-hostable'],
  ['Apache Superset', 'Open-source BI; the embedded SDK inserts an iframe', 'ClickHouse among supported databases', 'Guest tokens with row-level security rules', 'Free to self-host; Preset viewers $500 a month for 50', 'Open-source BI you are willing to run'],
  ['Tinybird', 'Managed ClickHouse with SQL published as API endpoints', 'Its own managed ClickHouse', 'JWTs with fixed parameters set by your backend', 'Free plan; paid plans plus usage', 'ClickHouse APIs without running clusters'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What are the best Embeddable alternatives?',
    answer:
      'For a data layer you build your own UI on, Cube or, on ClickHouse, hypequery. For customers who build their own reports, Luzmo, GoodData or Metabase. For open source you host, Apache Superset or Metabase. For managed ClickHouse with API endpoints, Tinybird. Which one fits depends on why you are moving off Embeddable.',
  },
  {
    question: 'How much does Embeddable cost?',
    answer:
      'Embeddable does not publish prices. Its pricing page, checked November 18, 2026, describes a flat monthly subscription with unlimited usage and every feature, priced mainly on project scope rather than monthly active users, and asks you to contact sales for a quote.',
  },
  {
    question: 'Is Embeddable built on Cube?',
    answer:
      'Yes. Embeddable’s docs say it uses Cube’s data modelling language, with models in *.cube.yml files. It runs a built-in Cube by default, and you can connect your own Cube Cloud or Cube Core instead. hypequery, Luzmo, GoodData, Metabase, Superset and Tinybird do not use Cube.',
  },
  {
    question: 'Is there an open-source alternative to Embeddable?',
    answer:
      'Yes. hypequery (ClickHouse only) and Cube Core are Apache 2.0 data layers; you build the dashboards. Apache Superset is Apache 2.0 BI that embeds dashboards through guest tokens. Metabase has an open-source edition whose free embeds carry a “Powered by Metabase” badge.',
  },
  {
    question: 'Which Embeddable alternatives support ClickHouse?',
    answer:
      'All of the alternatives on this page document ClickHouse. hypequery and Tinybird are built for it, and Cube, Luzmo, GoodData, Metabase and Superset list it as a data source. Embeddable lists ClickHouse among its connection types too.',
  },
];

const sources = [
  {
    vendor: 'Embeddable',
    urls: [
      'https://embeddable.com/pricing',
      'https://docs.embeddable.com/data-modeling/introduction',
      'https://docs.embeddable.com/data-modeling/row-level-security/access-policies',
      'https://docs.embeddable.com/data/bring-your-own-cube',
      'https://docs.embeddable.com/data/credentials',
      'https://docs.embeddable.com/dashboards/introduction',
      'https://docs.embeddable.com/deployment/embedding',
      'https://docs.embeddable.com/deployment/deployment-regions',
    ],
  },
  {
    vendor: 'Cube',
    urls: [
      'https://cube.dev/pricing',
      'https://cube.dev/embedded-analytics',
      'https://docs.cube.dev/admin/connect-to-data/data-sources',
      'https://github.com/cube-js/cube',
      'https://github.com/cube-js/cube/blob/master/docs-mintlify/embedding/multitenancy.mdx',
    ],
  },
  {
    vendor: 'Luzmo',
    urls: [
      'https://www.luzmo.com/pricing',
      'https://www.luzmo.com/connect',
      'https://developer.luzmo.com/guide/dashboard-embedding--embedded-dashboard-editor',
      'https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data',
    ],
  },
  {
    vendor: 'GoodData',
    urls: [
      'https://www.gooddata.ai/pricing/',
      'https://www.gooddata.ai/docs/cloud/workspaces/workspace-data-filters/',
      'https://www.gooddata.ai/docs/cloud/connect-data/create-data-sources/clickhouse/',
    ],
  },
  {
    vendor: 'Metabase',
    urls: [
      'https://www.metabase.com/pricing/',
      'https://www.metabase.com/docs/latest/embedding/introduction',
      'https://www.metabase.com/docs/latest/databases/connections/clickhouse',
    ],
  },
  {
    vendor: 'Apache Superset and Preset',
    urls: ['https://superset.apache.org/', 'https://github.com/apache/superset/tree/master/superset-embedded-sdk', 'https://preset.io/pricing/'],
  },
  {
    vendor: 'Tinybird',
    urls: ['https://www.tinybird.co/', 'https://www.tinybird.co/pricing', 'https://www.tinybird.co/docs/forward/administration/tokens/jwt'],
  },
  { vendor: 'Explo and Omni', urls: ['https://www.explo.co/', 'https://omni.co/blog/omni-acquires-explo/'] },
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

export default function EmbeddableAlternativesPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Embeddable alternatives' },
      ]}
      eyebrow="Embeddable alternatives"
      title="The best Embeddable alternatives for SaaS teams"
      updated={UPDATED}
      lead={
        <p>
          Pick the alternative by the reason you are leaving Embeddable. To keep the whole UI and data model in your own
          repo, use Cube, or hypequery if your data is in ClickHouse. If customers need to build their own reports, look
          at Luzmo, GoodData or Metabase. If you need a published price, Metabase, Cube, Luzmo and Preset list theirs,
          while Embeddable quotes each project.
        </p>
      }
      primaryCta={{ href: '#compared', label: 'Compare options', target: 'embeddable_alt_table' }}
      secondaryCta={{ href: '/compare/hypequery-vs-embeddable', label: 'hypequery vs Embeddable', target: 'embeddable_alt_vs' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Start here"
        title="Before switching: what Embeddable already includes"
        intro={
          <>
            <p>
              Embeddable splits dashboard work in two. Engineers write chart components in React and data models in
              Cube’s modelling language (<code className={inlineCode}>*.cube.yml</code> files). Anyone can then arrange
              those components into dashboards in a drag-and-drop builder, or define them as YAML in your repo. End users
              can build on templates you define with Custom Canvas. Dashboards are embedded with the{' '}
              <code className={inlineCode}>{'<em-beddable>'}</code> web component and a security token, not an iframe.
            </p>
            <p>
              Its{' '}
              <a href="https://docs.embeddable.com/data/credentials" rel="noopener nofollow" className={extLink}>
                connections page
              </a>{' '}
              lists 14 database types, ClickHouse among them. Embeddable runs a built-in Cube by default, or connects to
              your own Cube Cloud or Cube Core. The platform itself is hosted in US or EU regions.
            </p>
            <p>
              The pricing page at{' '}
              <a href="https://embeddable.com/pricing" rel="noopener nofollow" className={extLink}>
                embeddable.com/pricing
              </a>
              , checked on {VERIFIED_ON}, shows no price. It describes a flat monthly subscription with unlimited usage and every
              feature, priced mainly on project scope rather than monthly active users, white-labelled by default, with a
              custom quote from sales. For a deeper head-to-head, see{' '}
              <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
                hypequery vs Embeddable
              </Link>
              .
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="By reason for leaving"
        title="Embeddable alternatives grouped by the problem you want to fix"
      >
        <div className="space-y-14">
          <ReasonGroup
            id="own-the-stack"
            reason="I want the UI and the data layer in our own repo"
            intro={
              <p>
                With Embeddable, your components live in your code but the dashboards are assembled and served by a hosted
                platform. If every chart should ship through your normal deploy, and metric changes should show up in pull
                request diffs, these give you a data layer and leave the UI to you.
              </p>
            }
          >
            <Option name="hypequery">
              <p>
                An open-source semantic layer for ClickHouse. Measures, dimensions and a tenant key are TypeScript or Python
                datasets in your application repo, so a renamed metric shows up in the PR diff and breaks the type check
                for every caller. You get typed HTTP endpoints, React hooks and MCP tools from the same definitions.
                hypequery is our product.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> ClickHouse only, with no dashboard builder or chart
                components. You build every chart.
              </p>
            </Option>
            <Option name="Cube">
              <p>
                The semantic layer Embeddable builds on, used directly. Cube Core is open source (Apache 2.0 backend) and
                exposes your model through SQL, REST and GraphQL APIs. Cube Cloud adds embedded dashboards and an
                analytics chat on the Premium plan.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> another service to run or pay for, and models are still
                Cube YAML. See{' '}
                <Link href="/cube-js-alternative" className={inlineLink}>
                  Cube alternatives
                </Link>
                .
              </p>
            </Option>
          </ReasonGroup>

          <ReasonGroup
            id="full-bi"
            reason="Our customers need a full BI tool"
            intro={
              <p>
                Custom Canvas lets end users build on your templates. If customers expect to create dashboards from scratch,
                drill into data or write queries, these BI-first tools give them more.
              </p>
            }
          >
            <Option name="Luzmo">
              <p>
                A dashboard editor for your team plus an embedded editor your customers use to create and change dashboards
                inside your app. Connects to 19 databases, including ClickHouse. One published plan from €1,995 a month,
                billed annually.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> no smaller tier. See{' '}
                <Link href="/compare/luzmo-alternatives" className={inlineLink}>
                  Luzmo alternatives
                </Link>
                .
              </p>
            </Option>
            <Option name="GoodData">
              <p>
                Each customer gets a child workspace that inherits a parent model, narrowed by workspace data filters.
                Embedding (iframe, Web Components, React SDK), SSO and white-labelling are on both plans.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> a platform fee plus a fee per workspace, with no
                published amounts.
              </p>
            </Option>
            <Option name="Metabase">
              <p>
                With SSO embedding on Pro or Enterprise, embedded users get drill-through, the query builder, the SQL editor
                and AI chat, and Tenants keep each customer’s data apart.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> every SSO-embedded viewer is a billed user, at $12 a month
                each on Pro.
              </p>
            </Option>
          </ReasonGroup>

          <ReasonGroup
            id="published-pricing"
            reason="We need a price we can read before a sales call"
            intro={
              <p>
                Embeddable quotes each project. These publish enough to estimate a bill yourself. Prices verified{' '}
                {VERIFIED_ON}.
              </p>
            }
          >
            <Option name="Metabase">
              <p>
                Open source is free. Pro is $575 a month with 10 users, then $12 a user. Guest embeds work on every plan,
                are view-only, and their viewers are not counted as users. On Open Source and Starter they carry a “Powered
                by Metabase” badge.
              </p>
            </Option>
            <Option name="Cube">
              <p>
                A free plan, then Starter at $40 and Premium at $80 per developer a month. Premium viewer seats are $20 a
                user a month, and dedicated infrastructure is billed by the hour. Embedded dashboards need Premium.
              </p>
            </Option>
            <Option name="Preset (managed Superset)">
              <p>
                Embedded dashboard viewer licences are $500 a month for 50 viewers, on the Professional and Enterprise
                plans. Pricing above 50 viewers is through sales.
              </p>
            </Option>
          </ReasonGroup>

          <ReasonGroup
            id="clickhouse"
            reason="We’re on ClickHouse and don’t need a Cube layer"
            intro={
              <p>
                Embeddable reaches ClickHouse through Cube. If ClickHouse is your only analytical store, these work with it
                directly. hypequery, above, belongs here too.
              </p>
            }
          >
            <Option name="Tinybird">
              <p>
                Managed ClickHouse with hosted ingestion, where SQL is published as API endpoints. For user-facing apps, your
                backend signs a JWT whose fixed parameters set the tenant, and the browser cannot override them. There is a
                free plan.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> your data moves into Tinybird, and there are no chart
                components. See{' '}
                <Link href="/tinybird-alternative" className={inlineLink}>
                  Tinybird alternatives
                </Link>
                , or{' '}
                <Link href="/compare/clickhouse-cloud-vs-tinybird" className={inlineLink}>
                  ClickHouse Cloud vs Tinybird
                </Link>{' '}
                for the pricing side by side.
              </p>
            </Option>
            <Option name="Apache Superset">
              <p>
                Apache 2.0 BI that lists ClickHouse among its databases. The embedded SDK inserts an iframe after your
                backend requests a guest token, and guest tokens can carry row-level security rules for the tenant.
              </p>
              <p>
                <strong className="text-text">Trade-off:</strong> embedding is behind the{' '}
                <code className={inlineCode}>EMBEDDED_SUPERSET</code> feature flag, runs in an iframe, and you operate it.
              </p>
            </Option>
          </ReasonGroup>
        </div>
        <p className="mt-10 max-w-[760px] text-sm leading-6 text-text-muted">
          The arithmetic for 1,000 viewers across every vendor is in{' '}
          <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
            embedded analytics pricing compared
          </Link>
          . If you are weighing a fully in-house build, read{' '}
          <Link href="/compare/build-vs-buy-embedded-analytics" className={inlineLink}>
            build vs buy embedded analytics
          </Link>
          . We left out Explo because Omni announced on October 22, 2025 that it had acquired Explo and would move Explo
          customers onto Omni over the following 12 months.
        </p>
      </HubSection>

      <HubSection
        id="compared"
        eyebrow="Side by side"
        title="Embeddable and its alternatives compared"
        intro={<p>Checked against each vendor’s own site on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`Embeddable alternatives compared, verified ${VERIFIED_ON}`}
          columns={['Product', 'Approach', 'Data sources', 'Multi-tenancy', 'Pricing', 'Best for']}
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
              hypequery suits a narrow case. Your data is in ClickHouse, and your engineers want metrics and tenant rules as
              typed code in the app repo, reviewed in pull requests like any other change. Each dataset declares its tenant
              column once, and queries without trusted tenant context fail instead of returning every customer’s rows (see
              the{' '}
              <Link href="/docs/datasets/multi-tenancy" className={inlineLink}>
                multi-tenancy docs
              </Link>
              ). The same definitions serve your dashboards, a customer-facing API and AI agents through{' '}
              <Link href="/clickhouse-mcp" className={inlineLink}>
                MCP
              </Link>
              . The libraries are Apache 2.0 and free; hypequery cloud, the hosted option, is in early access with no
              published price.
            </p>
            <p>
              It is not a fit if product or customer teams need to assemble dashboards without a deploy, if you want a
              vendor-maintained chart library, or if your data lives in Postgres, Snowflake or BigQuery. hypequery has no
              dashboard builder and no chart components, and it supports only ClickHouse.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Stay or switch?"
        title="When to stay on Embeddable"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>Product managers or customer success change dashboards without waiting for an engineering release.</li>
            <li>You already have React components registered and Cube models written, and they work.</li>
            <li>Your data sits in more than one of its 14 connection types, such as ClickHouse and Postgres.</li>
            <li>A flat subscription with unlimited usage suits your budget better than per-viewer or per-developer pricing.</li>
            <li>You want embeds rendered as a web component in your own page, which Embeddable does without iframes.</li>
          </ul>
        }
      />

      <HubSection band eyebrow="Questions" title="Embeddable alternatives FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <section className={`${marketing.container} pb-14`}>
        <div className="rounded-xl border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
          <div>
            <p className={marketing.eyebrow}>Next step</p>
            <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">Define one dataset in your repo</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-text-muted">
              Point hypequery at a ClickHouse table you already have, add a tenant key, and serve it from your backend.
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
