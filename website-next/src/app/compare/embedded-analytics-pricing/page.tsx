import type { Metadata } from 'next';
import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubSources, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { absoluteUrl, ogImage } from '@/lib/site';
import { faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';
import { updatedFor } from '@/data/page-dates';

// RE-VERIFY QUARTERLY. Vendor prices on this page go stale faster than any other
// page on the site. Re-check every row against the source URLs below, update
// VERIFIED_ON here and this page's date in src/data/page-dates.ts, and update seo-verification-log.md. Next check due: February 2027.
const PATH = '/compare/embedded-analytics-pricing';
const TITLE = 'Embedded Analytics Pricing: Costs Compared (2026)';
const DESCRIPTION =
  'Compare Power BI, Metabase, Luzmo, Cube and other embedded analytics vendors by starting price, billing model and estimated cost for 1,000 viewers.';
const PUBLISHED = '2026-11-12';
const UPDATED = updatedFor(PATH);
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
    images: ogImage('Embedded analytics pricing compared'),
  },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';
const extLink = 'underline decoration-border-strong underline-offset-4 hover:text-accent';

const src = (href: string, label: string) => (
  <a href={href} rel="noopener nofollow" className={extLink}>
    {label}
  </a>
);

// Columns: vendor, model, lowest published price that allows embedding for customers, gated to higher tiers, scaling unit, source.
const masterRows = [
  ['Power BI Embedded', 'Capacity (hourly)', 'A1: $1.0081/hour, about $735.91/month at 730 hours (East US)', 'Viewers need no licence when the app owns the data; publishers need Pro or a service principal', 'Capacity size (A or F SKU)', src('https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/', 'azure.microsoft.com')],
  ['Microsoft Fabric (F SKUs)', 'Capacity (hourly)', 'F2: $0.36/hour, about $262.80/month at 730 hours (East US, pay as you go)', 'Below F64, embedding for your organisation needs a Pro or PPU licence per viewer', 'Capacity units', src('https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/', 'azure.microsoft.com')],
  ['Metabase', 'Plan fee plus per user', 'Open source: free, with “Powered by Metabase” badge. Pro: $575/month plus $12/user/month after 10 users', 'Row-level permissions, SSO, multi-tenant embedding and white-labelling start on Pro', 'Signed-in users; guest-embed viewers are not counted', src('https://www.metabase.com/pricing/', 'metabase.com/pricing')],
  ['Luzmo', 'Platform fee plus usage', '€1,995/month, billed annually', 'Nothing: one plan includes white-label, self-service, AI and APIs', 'AI conversations and Warp rows, or monthly active users on some contracts', src('https://www.luzmo.com/pricing', 'luzmo.com/pricing')],
  ['Embeddable', 'Flat subscription', 'Custom pricing (contact sales)', 'Nothing: every feature included', 'Project scope, not users or queries', src('https://embeddable.com/pricing', 'embeddable.com/pricing')],
  ['Preset (managed Superset)', 'Per user plus viewer bundles', 'Professional $20/user/month (annual) plus embedding add-on from $500/month for 50 viewers', 'Embedding is an add-on; SSO is Enterprise', 'Embedded viewer licences', src('https://preset.io/pricing/', 'preset.io/pricing')],
  ['Apache Superset', 'Open source', 'Free (Apache 2.0), self-hosted', 'None', 'Your infrastructure', src('https://superset.apache.org/', 'superset.apache.org')],
  ['Cube Cloud', 'Per developer plus hourly infrastructure', 'Premium: $80/developer/month plus hourly deployment ($1.20/hour dedicated)', 'Embedded dashboards and chat need Premium; SSO needs Enterprise', 'Developers, Viewer ($20) and Explorer ($40) seats, compute hours', src('https://cube.dev/pricing', 'cube.dev/pricing')],
  ['ThoughtSpot Embedded', 'Per user or per customer', 'Developer: free for one year, up to 10 users and 25M rows. Enterprise: custom', 'Production use beyond the Developer limits', 'Users or customers', src('https://www.thoughtspot.com/pricing', 'thoughtspot.com/pricing')],
  ['Sigma', 'Not published', 'Custom pricing (contact sales)', 'Not published', 'Not published', src('https://help.sigmacomputing.com/docs/intro-to-embedded-analytics', 'help.sigmacomputing.com')],
  ['Looker', 'Platform plus per user', 'Custom pricing (contact sales); an Embed edition exists', 'Not published', 'Instance plus users; AI usage in data tokens', src('https://cloud.google.com/looker/pricing', 'cloud.google.com/looker/pricing')],
  ['GoodData', 'Platform fee plus per workspace', 'Custom pricing (contact sales)', 'Self-hosting and most AI features are Enterprise', 'Workspaces (usually one per customer)', src('https://www.gooddata.ai/pricing/', 'gooddata.ai/pricing')],
  ['Sisense', 'Not published', 'Custom pricing (contact sales)', 'Multi-tenancy, white-labelling and SSO are listed under Enterprise', 'Not published', src('https://www.sisense.com/plans/', 'sisense.com/plans')],
  ['hypequery', 'Open source library', 'Free (Apache 2.0); hosted cloud not live, no pricing', 'None', 'Your ClickHouse and servers', <Link key="hq" href="/docs/cloud" className={extLink}>hypequery docs</Link>],
];

const scenarioRows = [
  ['Metabase Pro, guest embeds', '$575/month plan; the 3 builders fit in the 10 included users, and guest viewers are not billed as users', '$575/month', 'View-only embeds: no drill-through, query builder or AI chat'],
  ['Metabase Pro, SSO embeds', '$575 + (1,003 users − 10 included) × $12 = $575 + $11,916', '$12,491/month', 'Each viewer is a Metabase user; full interactivity'],
  ['Metabase open source, guest embeds', '$0 licence', '$0 plus hosting', '“Powered by Metabase” badge stays; AGPL applies'],
  ['Power BI Embedded A1', '$1.0081 × 730 hours', '$735.91/month plus publisher licences', 'Whether one A1 node carries your load is not something Microsoft sizes by user count'],
  ['Fabric F2', '2 CU × $0.18 × 730 hours', '$262.80/month plus publisher licences', 'Same sizing caveat; the smallest Fabric capacity'],
  ['Luzmo', 'One plan, billed annually', '€1,995/month (€23,940/year)', 'If usage stays within 500 AI conversations and 100M Warp rows a month, and the contract is not MAU-based'],
  ['Preset, embedded viewers', '20 bundles of 50 viewers × $500 = $10,000, plus 3 Professional seats × $20 = $60', '$10,060/month', 'Assumes the entry bundle rate holds at 1,000 viewers; Enterprise lists volume discounts of up to 90%'],
  ['Apache Superset, self-hosted', '$0 licence', '$0 plus hosting', 'You operate it, including guest-token auth'],
  ['hypequery', '$0 licence', '$0 plus hosting', 'You build the dashboards; ClickHouse only'],
  ['Luzmo MAU contracts, Embeddable, Sigma, Looker, GoodData, Sisense, ThoughtSpot Enterprise, Cube Cloud', 'Not enough published to compute', 'Ask for a quote', 'See the notes below for what each one scales on'],
];

const faqItems: FaqItem[] = [
  {
    question: 'How much does embedded analytics cost?',
    answer:
      'Published entry prices for embedding customer-facing analytics run from free open-source tools (Apache Superset, Metabase open source, hypequery) to about $262.80 a month for the smallest Microsoft Fabric capacity, $575 a month for Metabase Pro and €1,995 a month for Luzmo, checked November 12, 2026. Sigma, Looker, GoodData, Sisense and Embeddable quote only on request.',
  },
  {
    question: 'How much does Power BI Embedded cost?',
    answer:
      'Power BI Embedded is billed by capacity. In East US, the A1 SKU is $1.0081 an hour, about $735.91 a month running continuously, and the smallest Fabric capacity, F2, is $0.36 an hour, about $262.80 a month. When your app owns the data, viewers need no Power BI licence; people who publish need Pro or a service principal.',
  },
  {
    question: 'Is Metabase embedding free?',
    answer:
      'Metabase open source can embed charts and dashboards for free with guest embeds, but they keep the “Powered by Metabase” badge and are view-only. Removing the badge, row-level permissions, SSO embedding and multi-tenant embedding start on Pro at $575 a month plus $12 per user after the first 10.',
  },
  {
    question: 'What does Luzmo cost?',
    answer:
      'Luzmo’s single plan starts at €1,995 a month on an annual contract. The usage meter is AI conversations and Warp rows (500 and 100 million a month are included; each further million rows is €0.25), or monthly active users on some contracts.',
  },
  {
    question: 'Does Embeddable publish its prices?',
    answer:
      'No. Embeddable quotes each customer individually. The price is fixed per month and set by the scope of the project; its pricing page says neither monthly active users nor query volume is the main driver.',
  },
  {
    question: 'What is the cheapest way to embed analytics for 1,000 customer users?',
    answer:
      'By licence cost, the open-source options cost nothing: Apache Superset, Metabase open source (with its badge) and hypequery (ClickHouse only, you build the UI). Among paid tools, Metabase Pro with guest embeds is $575 a month regardless of viewer count. Hosting and engineering time are extra in every case.',
  },
];

const sources = [
  { vendor: 'Microsoft', urls: ['https://azure.microsoft.com/en-us/pricing/details/power-bi-embedded/', 'https://azure.microsoft.com/en-us/pricing/details/microsoft-fabric/', 'https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-capacity', 'https://learn.microsoft.com/en-us/power-bi/developer/embedded/embedded-analytics-power-bi'] },
  { vendor: 'Metabase', urls: ['https://www.metabase.com/pricing/', 'https://www.metabase.com/docs/latest/embedding/introduction', 'https://www.metabase.com/license'] },
  { vendor: 'Luzmo', urls: ['https://www.luzmo.com/pricing'] },
  { vendor: 'Embeddable', urls: ['https://embeddable.com/pricing'] },
  { vendor: 'Preset and Apache Superset', urls: ['https://preset.io/pricing/', 'https://superset.apache.org/'] },
  { vendor: 'Cube', urls: ['https://cube.dev/pricing'] },
  { vendor: 'ThoughtSpot', urls: ['https://www.thoughtspot.com/pricing'] },
  { vendor: 'Sigma', urls: ['https://www.sigmacomputing.com/pricing', 'https://help.sigmacomputing.com/docs/intro-to-embedded-analytics', 'https://help.sigmacomputing.com/docs/manage-access-to-a-secure-embed'] },
  { vendor: 'Looker', urls: ['https://cloud.google.com/looker/pricing'] },
  { vendor: 'GoodData', urls: ['https://www.gooddata.ai/pricing/'] },
  { vendor: 'Sisense', urls: ['https://www.sisense.com/plans/'] },
  { vendor: 'Explo and Omni', urls: ['https://www.explo.co/', 'https://www.explo.co/pricing', 'https://omni.co/blog/omni-acquires-explo/'] },
];

function Note({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className={marketing.card}>
      <h3 className="text-[17px] font-medium tracking-tight text-text">{name}</h3>
      <div className="mt-3 space-y-2 text-sm leading-6 text-text-muted">{children}</div>
    </div>
  );
}

export default function EmbeddedAnalyticsPricingPage() {
  return (
    <HubShell
      path={PATH}
      breadcrumbs={[
        { label: 'Home', href: '/' },
        { label: 'Compare', href: '/compare' },
        { label: 'Embedded analytics pricing' },
      ]}
      eyebrow="Pricing"
      title="Embedded analytics pricing in 2026: what the options cost"
      updated={UPDATED}
      lead={
        <p>
          Published prices run from no licence fee for self-hosted open-source tools to $575 a month for Metabase Pro,
          about $735.91 a month for a continuously running Power BI Embedded A1 capacity, and €1,995 a month for Luzmo.
          Many vendors still require a quote. The real comparison is the billing unit—viewer, capacity, workspace or
          usage—so we show both the entry price and a 1,000-viewer SaaS scenario. Every figure was checked against the
          vendor’s own page on {VERIFIED_ON}.
        </p>
      }
      primaryCta={{ href: '#scenario', label: 'See the worked scenario', target: 'pricing_scenario' }}
      secondaryCta={{ href: '/compare/embedded-analytics-platforms', label: 'Compare platforms', target: 'pricing_listicle' }}
      jsonLd={[
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        eyebrow="Price table"
        title="Embedded analytics pricing, vendor by vendor"
        intro={
          <p>
            “Lowest published price” means the cheapest listed option that lets you put analytics in front of your own
            customers. Where a vendor shows no number, the table says so instead of estimating one. Verified on{' '}
            {VERIFIED_ON}.
          </p>
        }
      >
        <HubTable
          caption={`Embedded analytics pricing by vendor, verified ${VERIFIED_ON}`}
          columns={['Vendor', 'Pricing model', 'Lowest published price for embedding', 'Gated or extra', 'Scales with', 'Source']}
          rows={masterRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Verified on {VERIFIED_ON}. Prices exclude tax. Azure prices are East US, USD, pay as you go; monthly figures
          multiply the hourly rate by 730 hours, the figure Azure’s own calculator uses. Tableau is omitted because its
          pricing pages could not be checked. hypequery is our product.
        </p>
      </HubSection>

      <HubSection
        id="scenario"
        band
        eyebrow="Worked scenario"
        title="Pricing one SaaS: 200 customer accounts, 5 viewers each"
        intro={
          <>
            <p>
              The scenario: a B2B SaaS with 200 customer accounts and 5 people per account who look at dashboards, so
              1,000 external viewers, plus 3 people on your team who build the dashboards. Viewers need tenant isolation
              and no vendor branding unless a row says otherwise. Prices are monthly list prices; annual-only plans are
              shown per month.
            </p>
            <p>
              Licence cost is not total cost. Self-hosted options add servers and on-call time, and the code-first options
              add the engineering to build charts. Capacity pricing depends on load, not head count.
            </p>
          </>
        }
      >
        <HubTable
          caption="1,000-viewer embedded analytics scenario, priced per vendor"
          columns={['Option', 'Arithmetic', 'Monthly licence cost', 'Assumptions and limits']}
          rows={scenarioRows}
        />
        <p className="mt-4 text-xs leading-5 text-text-dim">
          Verified on {VERIFIED_ON}. Luzmo is priced in euros and is not converted. Publisher licences for Power BI are
          not included; see the{' '}
          <Link href="/blog/power-bi-embedded-pricing" className={extLink}>
            Power BI Embedded pricing breakdown
          </Link>{' '}
          for those.
        </p>
      </HubSection>

      <HubSection eyebrow="Vendor notes" title="The pricing details that change the bill">
        <div className="grid gap-5 md:grid-cols-2">
          <Note name="Power BI Embedded">
            <p>
              You rent capacity by the hour, so cost is set by the SKU, not viewers. App-owns-data embeds need no viewer
              licences, but embedding for your own organisation on anything smaller than F64 (or on an A SKU) needs a Pro
              or Premium Per User licence for every viewer. Trial tokens show a banner and are for development only. Our{' '}
              <Link href="/blog/power-bi-embedded-pricing" className={inlineLink}>
                Power BI Embedded pricing guide
              </Link>{' '}
              covers every SKU.
            </p>
          </Note>
          <Note name="Metabase">
            <p>
              The free and Starter editions embed with a “Powered by Metabase” badge. Guest embeds (which replaced static
              embedding) don’t count viewers as users, but they are view-only. Interactive SSO embeds give viewers
              drill-through, the query builder and AI chat, and each viewer becomes a billed user: that is the jump from
              $575 to $12,491 a month in the scenario.
            </p>
          </Note>
          <Note name="Luzmo">
            <p>
              One plan with nothing held back, from €1,995 a month on an annual contract only; there is no smaller tier.
              The usage element is AI conversations and Warp rows, or monthly active users on some contracts. Ask which
              meter your contract uses before modelling growth.
            </p>
          </Note>
          <Note name="Embeddable">
            <p>
              A flat subscription with unlimited usage, priced on project scope by quote. That makes growth predictable,
              but you can’t compare it with anything until sales gives you a number.
            </p>
          </Note>
          <Note name="Tableau and Looker">
            <p>
              Looker’s Standard, Enterprise and Embed editions all say “Call sales”; pricing is a platform fee plus user
              licences, and signed-embed users are a user type. From February 1, 2027, Looker bills AI features, including
              embedded agents, in data tokens. Tableau’s pricing pages could not be checked for this page, so no Tableau
              prices appear here.
            </p>
          </Note>
          <Note name="Explo">
            <p>
              Explo no longer publishes pricing: its pricing page returns a 404. Omni announced its acquisition of Explo on
              October 22, 2025 and said it would migrate Explo customers to Omni over 12 months. If you are pricing Explo
              today, you are pricing Omni.
            </p>
          </Note>
          <Note name="Sigma">
            <p>
              Sigma’s pricing link goes to a contact form. Embeds use JWT-signed URLs; embed users can be created
              automatically and given an account type through the token, so ask how those account types are billed.
            </p>
          </Note>
          <Note name="Sisense">
            <p>
              No prices are published. The Self-Serve plan embeds by iframe or Compose SDK, while multi-tenant
              architecture, full white-labelling and SSO are listed under Enterprise, so a customer-facing deployment is
              likely an Enterprise conversation.
            </p>
          </Note>
          <Note name="ThoughtSpot Embedded">
            <p>
              The Developer plan is free for a year with up to 10 users and 25 million rows, which is enough to build but
              not to launch to 1,000 viewers. Enterprise is priced per user or per customer. ThoughtSpot says it does not
              charge for LLM tokens.
            </p>
          </Note>
          <Note name="Cube Cloud">
            <p>
              Embedded dashboards and chat need Premium ($80 per developer per month), with deployment and Cube Store
              workers billed hourly on top. Premium lists Viewer seats at $20 and Explorer seats at $40 per user per month;
              the pricing page does not say whether embedded end users need them, so ask.
            </p>
          </Note>
          <Note name="GoodData and Preset">
            <p>
              GoodData charges a platform fee plus a fee per workspace, and customers usually map to workspaces, so cost
              tracks your customer count; the amounts are not published. Preset sells embedded viewers in bundles of 50
              from $500 a month, with volume discounts on Enterprise.
            </p>
          </Note>
          <Note name="hypequery">
            <p>
              No licence fee: the Apache 2.0 libraries run inside your backend against your own ClickHouse. What you pay
              for is hosting and the engineering time to build the UI. There is no hosted price to compare yet, because
              hypequery cloud has not launched. See{' '}
              <Link href="/clickhouse-saas-analytics" className={inlineLink}>
                embedded analytics for SaaS
              </Link>
              .
            </p>
          </Note>
        </div>
      </HubSection>

      <HubSection
        band
        eyebrow="Before you sign"
        title="Questions to ask every vendor"
        intro={
          <ol className="list-decimal space-y-2 pl-5">
            <li>What exactly is the billing unit: monthly active viewer, named user, workspace, capacity hour or row?</li>
            <li>Do external viewers count as users, and does that change between view-only and interactive embeds?</li>
            <li>Are white-labelling, SSO, row-level security and multi-tenancy in the plan you are quoting?</li>
            <li>What happens to price at 2× and 10× your current customer count?</li>
            <li>Is the contract annual only, and what are the overage rates?</li>
            <li>Are AI features metered separately, and in what unit?</li>
            <li>Can it run in your own cloud, and does that cost more?</li>
          </ol>
        }
      />

      <HubSection eyebrow="Questions" title="Embedded analytics pricing FAQ">
        <HubFaq items={faqItems} />
      </HubSection>

      <HubSection
        band
        eyebrow="Related"
        title="Comparing more than price"
        intro={
          <p>
            Price is one axis. The{' '}
            <Link href="/compare/embedded-analytics-platforms" className={inlineLink}>
              embedded analytics platforms comparison
            </Link>{' '}
            groups these tools by architecture; the{' '}
            <Link href="/compare/luzmo-alternatives" className={inlineLink}>
              Luzmo alternatives
            </Link>{' '}
            page sorts them by why teams switch; and{' '}
            <Link href="/compare/hypequery-vs-embeddable" className={inlineLink}>
              hypequery vs Embeddable
            </Link>{' '}
            compares a code-first layer with a component platform.
          </p>
        }
      />

      <HubSources checkedOn={VERIFIED_ON} sources={sources} />
    </HubShell>
  );
}
