import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, itemListJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';

// Prices and plan gates here repeat /compare/embedded-analytics-pricing. Re-verify both together, quarterly.
const PATH = '/compare/embedded-analytics-platforms';
const TITLE = '12 Best Embedded Analytics Tools & Platforms (2026)';
const DESCRIPTION =
  'Compare 12 embedded analytics tools by multi-tenancy, embedding method, ClickHouse support, self-hosting and pricing, with the best fit for each team.';
const PUBLISHED = '2026-11-12';
const UPDATED = '2026-11-12';
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
    images: ogImage('Best embedded analytics platforms in 2026'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const pricingLink = (
  <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
    pricing compared
  </Link>
);

type Entry = {
  id: string;
  name: string;
  url: string;
  what: ReactNode;
  embedding: ReactNode;
  tenancy: ReactNode;
  pricing: ReactNode;
  bestFor: ReactNode;
  watchOut: ReactNode;
};

type Category = { id: string; title: string; intro: ReactNode; entries: Entry[] };

const categories: Category[] = [
  {
    id: 'code-first',
    title: 'Code-first and headless',
    intro: (
      <p>
        These give you a governed data layer and leave the screen to you, or split the screen into components your
        engineers write. Pick from this group when analytics is part of the product and has to look and behave like the
        rest of it.
      </p>
    ),
    entries: [
      {
        id: 'cube',
        name: 'Cube',
        url: 'https://cube.dev',
        what: 'The most widely used open-source semantic layer (Cube Core, Apache 2.0, about 21,200 GitHub stars), with Cube Cloud adding hosted agents, analytics chat and embedded dashboards on top.',
        embedding: 'REST, GraphQL and a Postgres-wire SQL API for headless use; chat and dashboard iframes and a React Embed SDK on Premium and Enterprise.',
        tenancy: 'A security context from a signed JWT, applied with queryRewrite and up to nine multitenancy options.',
        pricing: <>Seats per developer ($40 Starter, $80 Premium) with infrastructure billed by the hour; a free tier; Enterprise by quote. See {pricingLink}.</>,
        bestFor: 'One semantic layer over several databases, feeding your app, BI tools and agents.',
        watchOut: 'Embedded dashboards need Premium and SSO needs Enterprise. Running Cube Core yourself means several services, including Cube Store for pre-aggregations.',
      },
      {
        id: 'embeddable',
        name: 'Embeddable',
        url: 'https://embeddable.com',
        what: 'A hosted platform where engineers write React chart components and Cube data models in code, and anyone assembles dashboards from them in a no-code builder.',
        embedding: 'The <em-beddable> web component with a security token. No iframes.',
        tenancy: 'A security context passed to its Tokens API, applied by security filters, SQL-based rules in the model, or access policies on views.',
        pricing: <>Flat monthly subscription with unlimited usage; custom pricing (contact sales). See {pricingLink}.</>,
        bestFor: 'Teams who want their own components but need non-engineers to build and change dashboards.',
        watchOut: 'The platform is hosted in US or EU regions; only the Cube layer can be your own. AI endpoints are in beta.',
      },
      {
        id: 'hypequery',
        name: 'hypequery',
        url: 'https://hypequery.com',
        what: 'An open-source semantic layer for ClickHouse. Datasets (measures, dimensions, joins and tenant rules) are TypeScript or Python modules in your application repo, and the same definitions are served in-process, over HTTP with an OpenAPI spec, as React hooks and as MCP tools. hypequery is our product.',
        embedding: 'Headless: typed endpoints and React hooks; you render the charts.',
        tenancy: 'A tenant key on each dataset. Queries without a trusted tenant throw, and callers cannot filter on the tenant column themselves.',
        pricing: <>Open source (Apache 2.0) and free. A hosted cloud is on a waitlist with no published pricing.</>,
        bestFor: 'Engineering teams on ClickHouse who want one typed model behind in-app dashboards, a public API and agents.',
        watchOut: 'ClickHouse only: no Postgres, BigQuery or Snowflake. No chart components and no dashboard builder.',
      },
    ],
  },
  {
    id: 'embedded-bi',
    title: 'Embedded BI platforms',
    intro: (
      <p>
        Products built to put dashboards inside someone else’s app, with an editor, ready-made charts and per-customer
        isolation. Pick from this group to ship many dashboards quickly, or to let customers explore data on their own.
      </p>
    ),
    entries: [
      {
        id: 'luzmo',
        name: 'Luzmo',
        url: 'https://www.luzmo.com',
        what: 'An embedded analytics platform with a dashboard editor, an embedded editor your customers can use, the Flex SDK for building charts from code, and Luzmo IQ for AI answers.',
        embedding: 'Web component plus React, React Native, Angular and Vue components, authorised with a server-side embed token.',
        tenancy: 'Parameter filters overridden per user on the embed token (parameter_overrides), or a separate connection per tenant (account_overrides).',
        pricing: <>One plan from €1,995 a month, billed annually, plus usage. See {pricingLink}.</>,
        bestFor: 'SaaS teams who want every feature, white-label included, from one vendor without assembling parts.',
        watchOut: 'There is no smaller tier and billing is annual only.',
      },
      {
        id: 'sigma',
        name: 'Sigma',
        url: 'https://www.sigmacomputing.com',
        what: 'A BI platform with public and secure embedding, and an assistant and agents that can be embedded alongside dashboards.',
        embedding: 'Secure embeds through one-time JWT-signed URLs generated server-side; a React embed SDK.',
        tenancy: 'JWT claims (team, account type, user attributes) with row-level security and Sigma Tenants.',
        pricing: <>Not published; custom pricing (contact sales).</>,
        bestFor: 'Customers who expect to explore and analyse data, not only view fixed dashboards.',
        watchOut: 'ClickHouse support is in beta. Ask how automatically created embed users are billed.',
      },
      {
        id: 'thoughtspot',
        name: 'ThoughtSpot Embedded',
        url: 'https://www.thoughtspot.com',
        what: 'ThoughtSpot’s search and AI analytics, packaged for embedding in apps, with a native ClickHouse connector.',
        embedding: 'The Visual Embed SDK (JavaScript, iframe-based) for charts, Liveboards and search, plus REST APIs.',
        tenancy: 'Its pricing page lists row-level security and multi-tenancy by organisation.',
        pricing: <>Developer plan free for one year (up to 10 users, 25M rows); Enterprise custom. See {pricingLink}.</>,
        bestFor: 'Natural-language search and AI answers inside your product.',
        watchOut: 'The free plan is for building, not launching. Which Enterprise features sit in which tier is not shown in text on the pricing page.',
      },
      {
        id: 'gooddata',
        name: 'GoodData',
        url: 'https://www.gooddata.ai',
        what: 'GoodData Cloud: dashboards, a workspace model that child workspaces inherit, MAQL for metrics, and a beta VS Code extension for keeping definitions as YAML.',
        embedding: 'iframe, Web Components, React SDK (GoodData.UI) and APIs.',
        tenancy: 'Hierarchical workspaces, usually one per customer, with workspace data filters.',
        pricing: <>Platform fee plus per workspace; custom pricing (contact sales).</>,
        bestFor: 'Many customer tenants managed from one parent model, with embedding, SSO and white-labelling on the Professional plan.',
        watchOut: 'Cost grows with workspaces. Most AI features, the MCP server and self-hosting are Enterprise.',
      },
      {
        id: 'sisense',
        name: 'Sisense',
        url: 'https://www.sisense.com',
        what: 'A BI platform with an embedding SDK, Compose SDK, for React, Angular and Vue, built-in natural-language queries and a bring-your-own-LLM option.',
        embedding: 'iframe or Compose SDK, including on the Self-Serve plan.',
        tenancy: 'Multi-tenant architecture is listed under its Enterprise plan.',
        pricing: <>Not published; custom pricing (contact sales).</>,
        bestFor: 'Large deployments that need on-premises or dedicated cloud hosting.',
        watchOut: 'Multi-tenancy, full white-labelling and SSO are Enterprise features. ClickHouse support could not be confirmed in its docs.',
      },
    ],
  },
  {
    id: 'bi-with-embedding',
    title: 'BI tools with embedding',
    intro: (
      <p>
        General BI tools that can also be embedded. Pick from this group if you already run one internally, or if
        licence cost matters more than a native look.
      </p>
    ),
    entries: [
      {
        id: 'metabase',
        name: 'Metabase',
        url: 'https://www.metabase.com',
        what: 'An open-source BI tool (AGPL) with a built-in ClickHouse driver, and paid editions for embedding without its badge.',
        embedding: 'Modular embedding with web components or a React SDK; full-app iframe embedding. Guest embeds (JWT, view-only) replace static embedding.',
        tenancy: 'Tenants plus SSO for interactive embeds; locked parameters in a signed token for guest embeds.',
        pricing: <>Open source free; Pro from $575 a month plus $12 per user; Enterprise from $20,000 a year. See {pricingLink}.</>,
        bestFor: 'Budget-conscious teams who want a working embed on day one and may self-host.',
        watchOut: 'Free and Starter embeds carry a “Powered by Metabase” badge. Interactive SSO embeds bill every viewer as a user.',
      },
      {
        id: 'power-bi',
        name: 'Power BI Embedded',
        url: 'https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/',
        what: 'Microsoft’s Power BI reports, served from Azure capacity you rent by the hour.',
        embedding: 'JavaScript and .NET SDKs and REST APIs; secure URL or iframe embedding for portals.',
        tenancy: 'Row-level security with an effective identity on the embed token, or a workspace per tenant with service principal profiles.',
        pricing: <>Capacity: A1 about $735.91 a month, Fabric F2 about $262.80 a month (East US, 730 hours). See the <Link href="/blog/power-bi-embedded-pricing" className={inlineLink}>Power BI Embedded pricing guide</Link>.</>,
        bestFor: 'Teams already building reports in Power BI who want viewers to need no licence.',
        watchOut: 'Capacity has to be sized for load. With ClickHouse, the Power BI service needs the ODBC-based connector and an on-premises data gateway.',
      },
      {
        id: 'looker',
        name: 'Looker',
        url: 'https://cloud.google.com/looker',
        what: 'Google Cloud’s BI platform, built on LookML models, with a dedicated Embed edition for external analytics.',
        embedding: 'Signed embedding (“Signed Embed / Powered by Looker users”).',
        tenancy: 'Signed embed users are a licensed user type; the embedding docs could not be checked for this page.',
        pricing: <>Platform plus per-user licences; all editions “Call sales”. AI usage billed in data tokens from February 1, 2027.</>,
        bestFor: 'Companies with existing LookML models they want to reuse for customers.',
        watchOut: 'Nothing is priced publicly, and AI usage gets its own meter in 2027.',
      },
      {
        id: 'superset',
        name: 'Apache Superset',
        url: 'https://superset.apache.org',
        what: 'An open-source (Apache 2.0) BI tool, also sold as a managed service by Preset.',
        embedding: 'The @superset-ui/embedded-sdk package inserts an iframe after your backend requests a guest token.',
        tenancy: 'Guest tokens carry row-level security clauses, for example a filter on the tenant column.',
        pricing: <>Free to self-host. Preset embedding is an add-on from $500 a month for 50 viewers. See {pricingLink}.</>,
        bestFor: 'Teams who want open-source BI with embedding and are happy to operate it.',
        watchOut: 'Embedding is behind a feature flag and runs in an iframe. Preset’s embedded viewers get limited interactivity.',
      },
    ],
  },
];

const allEntries = categories.flatMap((category) => category.entries);
// 1-based position of each entry across all groups, matching the ItemList JSON-LD order.
const entryNumber = new Map(allEntries.map((entry, index) => [entry.id, index + 1]));

const masterRows = [
  ['Cube', 'Code-first', 'APIs; iframes and React SDK on Premium', 'JWT security context', 'Yes', 'Yes (Cube Core)', 'Per developer plus infrastructure'],
  ['Embeddable', 'Code-first', 'Web component', 'Token security context', 'Yes', 'Cube layer only', 'Flat subscription, quote'],
  ['hypequery', 'Code-first', 'Headless API, React hooks', 'Tenant key per dataset', 'Yes', 'Yes (library)', 'Free, open source'],
  ['Luzmo', 'Embedded BI', 'Web component, framework components', 'Embed token filters or connection per tenant', 'Yes', 'Private infrastructure option', 'Platform fee plus usage'],
  ['Sigma', 'Embedded BI', 'JWT-signed URL, React SDK', 'JWT claims, RLS, Tenants', 'Beta', 'Not checked', 'Quote'],
  ['ThoughtSpot Embedded', 'Embedded BI', 'Visual Embed SDK (iframe)', 'RLS, multi-tenant by organisation', 'Yes', 'Not checked', 'Per user or customer'],
  ['GoodData', 'Embedded BI', 'iframe, Web Components, React SDK', 'Workspaces with data filters', 'Yes', 'Enterprise, on demand', 'Platform fee plus workspaces'],
  ['Sisense', 'Embedded BI', 'iframe, Compose SDK', 'Enterprise multi-tenant architecture', 'Not confirmed', 'Enterprise on-premises', 'Quote'],
  ['Metabase', 'BI with embedding', 'Web components, React SDK, iframe', 'Tenants with SSO, or locked parameters', 'Yes', 'Yes', 'Plan fee plus per user'],
  ['Power BI Embedded', 'BI with embedding', 'JS and .NET SDKs, iframe', 'RLS or workspace per tenant', 'Via connector and gateway', 'Not checked (embedding runs on Azure capacity)', 'Capacity per hour'],
  ['Looker', 'BI with embedding', 'Signed embedding', 'Signed embed users', 'Yes', 'Not checked', 'Platform plus per user, quote'],
  ['Apache Superset', 'BI with embedding', 'Embedded SDK (iframe)', 'Guest tokens with RLS', 'Yes', 'Yes', 'Free; Preset per viewer bundle'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What is embedded analytics?',
    answer:
      'Embedded analytics is charts, dashboards and reports shown inside your own product to your own customers, each scoped to that customer’s data. It differs from internal BI, where employees analyse data across the whole company in a separate tool.',
  },
  {
    question: 'What is the difference between iframe and SDK embedding?',
    answer:
      'iframe embedding loads the vendor’s page inside a frame in your app: quick to add, but styling and interaction stop at the frame. SDK embedding, through web components or React components from tools like Luzmo, Metabase or Embeddable, renders inside your page, so it can share styles and events with your app. Headless tools such as hypequery and Cube return data and leave rendering to you.',
  },
  {
    question: 'What are the open-source embedded analytics options?',
    answer:
      'Apache Superset (Apache 2.0) and Metabase (AGPL open source edition) are open-source BI tools that can embed dashboards; Metabase’s free embeds keep its badge. Cube Core (Apache 2.0) and hypequery (Apache 2.0, ClickHouse only) are open-source semantic layers you build your own dashboards on.',
  },
  {
    question: 'What is the best embedded analytics platform?',
    answer:
      'It depends on who builds the dashboards. For a complete white-labelled product, Luzmo or GoodData; for customers who explore data themselves, Sigma or ThoughtSpot; for low licence cost, Metabase or Superset; for owning the front end, Cube, Embeddable or, on ClickHouse, hypequery.',
  },
  {
    question: 'Which embedded analytics tools support ClickHouse?',
    answer:
      'Of the 12 platforms here, hypequery, Cube, Embeddable, Luzmo, ThoughtSpot, GoodData, Metabase, Looker and Superset document ClickHouse connections. Sigma’s ClickHouse connector is in beta, Power BI connects through an ODBC-based connector and a data gateway, and Sisense’s support could not be confirmed.',
  },
  {
    question: 'What happened to Explo?',
    answer:
      'Omni announced it had acquired Explo on October 22, 2025, and said Explo customers would migrate to Omni over the following 12 months. Explo’s site now shows an “Explo is joining Omni” banner and its pricing page returns a 404.',
  },
];

const sources = [
  { vendor: 'Cube', urls: ['https://cube.dev/pricing', 'https://cube.dev/embedded-analytics', 'https://github.com/cube-js/cube'] },
  { vendor: 'Embeddable', urls: ['https://embeddable.com/pricing', 'https://docs.embeddable.com/deployment/embedding', 'https://docs.embeddable.com/data-modeling/row-level-security/access-policies', 'https://docs.embeddable.com/deployment/deployment-regions'] },
  { vendor: 'Luzmo', urls: ['https://www.luzmo.com/pricing', 'https://developer.luzmo.com/guide/dashboard-embedding--embed-into-application', 'https://developer.luzmo.com/guide/dashboard-embedding--handling-multi-tenant-data'] },
  { vendor: 'Sigma', urls: ['https://help.sigmacomputing.com/docs/intro-to-embedded-analytics', 'https://help.sigmacomputing.com/docs/connect-to-clickhouse'] },
  { vendor: 'ThoughtSpot', urls: ['https://www.thoughtspot.com/pricing', 'https://developers.thoughtspot.com/docs/getting-started', 'https://clickhouse.com/docs/integrations/connectors/data-visualization/thoughtspot-and-clickhouse'] },
  { vendor: 'GoodData', urls: ['https://www.gooddata.ai/pricing/', 'https://www.gooddata.ai/docs/cloud/connect-data/create-data-sources/clickhouse/'] },
  { vendor: 'Sisense', urls: ['https://www.sisense.com/plans/', 'https://www.sisense.com/ai-analytics-platform/compose-sdk/'] },
  { vendor: 'Metabase', urls: ['https://www.metabase.com/pricing/', 'https://www.metabase.com/docs/latest/embedding/introduction', 'https://www.metabase.com/docs/latest/databases/connections/clickhouse'] },
  { vendor: 'Microsoft', urls: ['https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/', 'https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-row-level-security', 'https://clickhouse.com/docs/integrations/connectors/data-visualization/powerbi-and-clickhouse'] },
  { vendor: 'Looker', urls: ['https://cloud.google.com/looker/pricing', 'https://clickhouse.com/docs/integrations/connectors/data-visualization/looker-and-clickhouse'] },
  { vendor: 'Apache Superset and Preset', urls: ['https://superset.apache.org/', 'https://www.npmjs.com/package/@superset-ui/embedded-sdk', 'https://preset.io/pricing/'] },
  { vendor: 'Explo, Omni, Domo and Progress', urls: ['https://omni.co/blog/omni-acquires-explo/', 'https://www.explo.co/', 'https://www.domo.com/news/press/progress-software-completes-acquisition-of-domos-ai-and-data-platform-business'] },
];

function EntryCard({ entry, index }: { entry: Entry; index: number }) {
  const rows: Array<[string, ReactNode]> = [
    ['Embedding', entry.embedding],
    ['Multi-tenancy', entry.tenancy],
    ['Pricing model', entry.pricing],
    ['Best for', entry.bestFor],
    ['Watch out for', entry.watchOut],
  ];
  return (
    <article id={entry.id} className={`${marketing.card} scroll-mt-24`}>
      <h3 className={marketing.cardTitle}>
        <span className="mr-2 font-mono text-sm text-text-dim">{index}.</span>
        {entry.name}
      </h3>
      <p className="mt-3 text-sm leading-6 text-text-muted">{entry.what}</p>
      <dl className="mt-4 space-y-2 text-sm leading-6">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[130px_1fr]">
            <dt className="font-medium text-text">{label}</dt>
            <dd className="text-text-muted">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

export default function EmbeddedAnalyticsPlatformsPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Embedded analytics platforms' },
      ]}
      eyebrow="Embedded analytics platforms"
      title="12 embedded analytics tools and platforms compared"
      updated={UPDATED}
      lead={
        <p>
          Start with who needs to build the dashboard. If it is your engineers, shortlist Cube, Embeddable or hypequery.
          If product teams need a visual builder, look at Luzmo, GoodData or Sisense. If you already have an internal BI
          tool—or need the lowest-cost route—Metabase, Power BI, Looker or Superset may be a better fit. This guide
          compares all 12 by embedding method, tenant isolation, ClickHouse support and price.
        </p>
      }
      primaryCta={{ href: '#master-table', label: 'Compare all 12', target: 'listicle_table' }}
      secondaryCta={{ href: '/compare/embedded-analytics-pricing', label: 'Pricing compared', target: 'listicle_pricing' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        itemListJsonLd(
          'Embedded analytics platforms, grouped by approach',
          allEntries.map((entry) => ({ name: entry.name, url: entry.url })),
        ),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Method"
        title="How we compared these embedded analytics tools"
        intro={
          <>
            <p>
              We included tools that SaaS teams shortlist for customer-facing analytics and that publish enough
              documentation to evaluate. Each was checked against its own pricing page, docs or repository on{' '}
              {VERIFIED_ON}, on seven criteria:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong className="text-text">Multi-tenancy:</strong> how one customer is kept from another’s data, and
                where that rule lives.
              </li>
              <li>
                <strong className="text-text">Embedding method:</strong> iframe, SDK or web component, or a headless API.
              </li>
              <li>
                <strong className="text-text">Data sources:</strong> in particular whether ClickHouse is supported.
              </li>
              <li>
                <strong className="text-text">Pricing transparency:</strong> whether a price for embedding is published.
              </li>
              <li>
                <strong className="text-text">White-labelling and self-service:</strong> whether customers can build or
                edit dashboards without seeing the vendor’s brand.
              </li>
              <li>
                <strong className="text-text">AI features:</strong> assistants, agents and MCP that work inside an embed.
              </li>
              <li>
                <strong className="text-text">Self-hosting:</strong> whether it can run in your own infrastructure.
              </li>
            </ul>
            <p>
              hypequery is our product. It is listed last in the group it belongs to, with its limits. The numbers are
              for reference only; within each group, tools are in no particular order. We left out Explo: Omni acquired it in
              October 2025 and is moving its customers to Omni. Domo is now part of Progress Software, which completed its
              purchase of Domo’s platform business on September 22, 2026.
            </p>
          </>
        }
      />

      {categories.map((category, categoryIndex) => (
        <HubSection
          key={category.id}
          id={category.id}
          band={categoryIndex % 2 === 0}
          eyebrow={`Group ${categoryIndex + 1}`}
          title={category.title}
          intro={category.intro}
        >
          <div className="grid gap-5 lg:grid-cols-2">
            {category.entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} index={entryNumber.get(entry.id) ?? 0} />
            ))}
          </div>
        </HubSection>
      ))}

      <HubSection
        id="master-table"
        eyebrow="Full comparison"
        title="Embedded analytics tools: all 12 side by side"
        intro={<p>Use this table to narrow the list by architecture, tenant model, ClickHouse support and cost. Verified on {VERIFIED_ON}.</p>}
      >
        <HubTable
          caption={`12 embedded analytics platforms compared, verified ${VERIFIED_ON}`}
          columns={['Platform', 'Group', 'Embedding', 'Multi-tenancy', 'ClickHouse', 'Self-host', 'Pricing model']}
          rows={masterRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Verified on {VERIFIED_ON}. “Not checked” means the vendor’s pages we read did not answer the question. hypequery is our product.
        </p>
      </HubSection>

      <HubSection
        band
        eyebrow="Embedding methods"
        title="iframe, SDK or headless: what changes for your app"
        intro={
          <>
            <p>
              The embedding method decides how much of the result feels like your product. Every tool above uses one of
              four, and several offer more than one.
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-text">iframe.</strong> The vendor’s page loads inside a frame. It is the fastest to
                add and isolates the vendor’s code from yours, but fonts, spacing and events stop at the frame’s edge.
                Superset’s embedded SDK, ThoughtSpot’s Visual Embed SDK and Metabase’s full-app embedding all work this
                way.
              </li>
              <li>
                <strong className="text-text">Web components.</strong> A custom HTML element, such as Embeddable’s{' '}
                <code className="font-mono text-[0.92em] text-text">{'<em-beddable>'}</code> or Metabase’s guest embeds,
                renders inside your page without a frame. It works in any framework and can pick up your styles.
              </li>
              <li>
                <strong className="text-text">Framework SDKs.</strong> React (and sometimes Angular or Vue) components
                you import, as Luzmo, Sigma, GoodData, Sisense and Metabase offer. You place them like your own
                components and can react to their events.
              </li>
              <li>
                <strong className="text-text">Headless.</strong> The tool returns data through an API and draws nothing.
                Cube’s APIs and hypequery’s endpoints and hooks work this way. You get full control and you do all the
                rendering.
              </li>
            </ul>
            <p>
              Whichever method you use, the signed token or session that authorises the embed is created on your server.
              That server-side step is where tenant isolation is decided.
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Multi-tenancy"
        title="Three ways these tools keep customers apart"
        intro={
          <>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong className="text-text">A filter carried in a signed token.</strong> Your server signs a token
                naming the customer, and the tool applies a row-level filter from it. Luzmo’s parameter overrides, Sigma’s
                JWT claims, Superset’s guest-token RLS clauses, Metabase’s locked parameters and Power BI’s effective
                identity all follow this pattern. The risk to check: whether the filter is fixed at the dataset level or
                can be removed in an editor. Luzmo’s docs, for one, recommend dataset-level filters for exactly this
                reason.
              </li>
              <li>
                <strong className="text-text">A separate space per customer.</strong> GoodData gives each customer a
                workspace; Power BI can use a workspace per tenant; Luzmo can point each customer at its own database
                connection. Isolation is stronger, and cost or admin work often grows with the number of customers.
              </li>
              <li>
                <strong className="text-text">A rule in the data model.</strong> The tenant column is declared in the
                semantic model, and the layer refuses to run a query without it. Cube’s security context with
                queryRewrite and hypequery’s tenant key work this way. Embeddable’s access policies sit between this and
                the first pattern.
              </li>
            </ol>
            <p>
              For ClickHouse specifically, the{' '}
              <Link href="/blog/embedded-analytics-clickhouse-multi-tenant-dashboards" className={inlineLink}>
                multi-tenant embedded analytics guide
              </Link>{' '}
              covers row policies, sorting keys and per-tenant quotas underneath whichever tool you choose.
            </p>
          </>
        }
      />

      <HubSection
        band
        eyebrow="Decision guide"
        title="Which embedded analytics platform should you choose?"
        intro={
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-text">Non-engineers must build and edit customer dashboards:</strong> Luzmo,
              GoodData or Embeddable, which all have builders.
            </li>
            <li>
              <strong className="text-text">Customers want to explore, not just view:</strong> Sigma or ThoughtSpot, or
              Metabase with interactive SSO embeds.
            </li>
            <li>
              <strong className="text-text">The lowest licence cost:</strong> Superset or Metabase open source if you can
              host them; see{' '}
              <Link href="/compare/embedded-analytics-pricing" className={inlineLink}>
                embedded analytics pricing
              </Link>{' '}
              for a 1,000-viewer worked example.
            </li>
            <li>
              <strong className="text-text">You already report in Power BI or Looker:</strong> embed what you have.
            </li>
            <li>
              <strong className="text-text">Many databases behind one model:</strong> Cube. See{' '}
              <Link href="/cube-js-alternative" className={inlineLink}>
                Cube alternatives
              </Link>{' '}
              for other semantic layers, and what headless BI means.
            </li>
            <li>
              <strong className="text-text">You are on ClickHouse and want the same metrics in your UI, API and agents:</strong>{' '}
              hypequery. See{' '}
              <Link href="/clickhouse-saas-analytics" className={inlineLink}>
                embedded analytics for SaaS on ClickHouse
              </Link>
              .
            </li>
            <li>
              <strong className="text-text">Leaving a vendor:</strong> see{' '}
              <Link href="/compare/luzmo-alternatives" className={inlineLink}>
                Luzmo alternatives
              </Link>{' '}
              and{' '}
              <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
                hypequery vs Embeddable
              </Link>
              .
            </li>
          </ul>
        }
      />

      <HubSection eyebrow="Questions" title="Embedded analytics platforms FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
