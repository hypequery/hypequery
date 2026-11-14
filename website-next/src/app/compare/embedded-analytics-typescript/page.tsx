import type { Metadata } from 'next';
import Link from 'next/link';
import { HubFaq, HubSection, HubShell, HubTable } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { updatedFor } from '@/data/page-dates';
import { absoluteUrl, ogImage } from '@/lib/site';
import { breadcrumbJsonLd, faqJsonLd, techArticleJsonLd, type FaqItem } from '@/lib/structured-data';

const PATH = '/compare/embedded-analytics-typescript';
const TITLE = "Embedded Analytics Buyer's Guide for TypeScript Teams";
const DESCRIPTION =
  'Compare embedded analytics architectures for TypeScript teams by metric governance, tenant isolation, type safety, change control and UI ownership, with a proof-based evaluation checklist.';
const PUBLISHED = '2026-11-14';
const UPDATED = updatedFor(PATH);

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl(PATH) },
  openGraph: {
    type: 'article',
    url: absoluteUrl(PATH),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
    images: ogImage('Embedded analytics for TypeScript teams'),
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const inlineLink =
  'font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent';

const architectureRows = [
  [
    'BI tool embedded by iframe or SDK',
    'Metrics usually live in the BI model or individual dashboards.',
    'Strong when every embed uses the same governed model; weaker when logic is copied between reports.',
    'The vendor owns most of the UI; your app supplies identity and tenant context.',
    'Teams that need many dashboards quickly or customer self-service.',
  ],
  [
    'Component platform with a dashboard builder',
    'A shared data model plus chart components registered by engineers.',
    'Good when the builder can only use governed measures and dimensions.',
    'Engineers own components; product or data teams assemble dashboards.',
    'Teams that want a native-looking UI without making every change a deploy.',
  ],
  [
    'Standalone semantic layer with a custom UI',
    'Metrics, joins and access rules live in a service between the database and every consumer.',
    'Strong across dashboards, BI tools and agents when they all use that service.',
    'Your team owns the UI; the semantic-layer service owns query compilation.',
    'Several teams or tools need one definition across more than one data source.',
  ],
  [
    'Code-first layer inside the TypeScript backend',
    'Metrics and tenant rules are modules in the application repository.',
    'Strong across the API, React UI and agents when they import or call the same definitions.',
    'Your team owns the API and UI; there is no dashboard builder.',
    'Product engineers on one primary analytics database who want normal code review and tests.',
  ],
  [
    'Custom SQL API plus a chart library',
    'Whatever conventions your team builds and enforces.',
    'Potentially strong, but only if every route reuses a deliberate metric and policy layer.',
    'Your team owns everything.',
    'A narrow analytics surface where the team accepts the engineering and governance work.',
  ],
];

const checklistRows = [
  [
    'One source for metric definitions',
    'A named metric such as `netRevenue` has one reviewed definition, including joins, exclusions and time behavior.',
    'Change the definition once and show that a dashboard, API response and agent query all change together.',
  ],
  [
    'Types at the application boundary',
    'The TypeScript types reflect the values the database or API actually returns, including large integers and nulls.',
    'Rename a field or change its type and confirm that affected consumers fail during CI, not after deployment.',
  ],
  [
    'Tenant isolation outside request input',
    'The tenant comes from verified server-side identity and is applied centrally. Missing scope fails closed.',
    'Remove tenant context, then try to supply or override a tenant in the request. Both attempts should be rejected.',
  ],
  [
    'Governed dimensions and filters',
    'Consumers can only group and filter by fields that the model deliberately exposes.',
    'Ask for an internal column and an unsupported join. The system should reject both before query execution.',
  ],
  [
    'Reviewable change process',
    'Metric, access and schema changes have a diff, an owner, automated checks and a rollback path.',
    'Walk one metric change from pull request to preview to production, then roll it back.',
  ],
  [
    'The same model for every consumer',
    'Dashboards, exports, public APIs and agents do not rebuild business logic in separate query layers.',
    'Trace one answer from each surface to the exact metric version and generated query that produced it.',
  ],
  [
    'Bounded execution',
    'Limits, timeouts, caching and rate limits protect the database from expensive or repeated requests.',
    'Request an unbounded result and exceed a tenant quota; verify the failure is explicit and observable.',
  ],
  [
    'Portable ownership boundary',
    'You know which model, API, UI and infrastructure pieces you own, and what must be rebuilt if you leave.',
    'Export the model and reproduce one production query without the vendor dashboard or hosted runtime.',
  ],
];

const scoreRows = [
  ['Metric consistency', '25%', 'Does one reviewed definition reach every customer-facing surface?'],
  ['Tenant isolation and access control', '25%', 'Can a missing or caller-supplied tenant ever broaden a query?'],
  ['Product and developer fit', '15%', 'Does the workflow match who will build dashboards and how your TypeScript team ships?'],
  ['Change safety', '15%', 'Are diffs, tests, previews, ownership and rollback part of the normal workflow?'],
  ['UI control and self-service', '10%', 'Do you need a native product surface, a customer editor, or both?'],
  ['Operations and cost', '10%', 'What must you host, monitor and pay for as tenants, viewers and queries grow?'],
];

const faqItems: FaqItem[] = [
  {
    question: 'What should a TypeScript team compare first in embedded analytics tools?',
    answer:
      'Start with where metric definitions and tenant rules live, then prove that every dashboard, API and agent uses them. A React SDK is useful, but it does not by itself prevent duplicated metrics or a missing tenant filter.',
  },
  {
    question: 'How do embedded analytics tools keep metrics consistent?',
    answer:
      'The reliable pattern is one named metric model used by every consumer. The model may live in a BI platform, a standalone semantic layer or your application repository. Consistency breaks when dashboards, API routes and agents each carry their own SQL.',
  },
  {
    question: 'Should embedded analytics definitions live in TypeScript?',
    answer:
      'They should when product engineers own the analytics surface, deploy it with the application and benefit from code review and compile-time checks. A separate semantic platform is often a better fit when a data team owns metrics for many databases and BI tools.',
  },
  {
    question: 'Is a custom React dashboard the same as building embedded analytics from scratch?',
    answer:
      'No. You can own the React UI while buying or adopting the governed data layer underneath it. The build-or-buy decision is separable across the model, API, components, dashboard editor and hosting.',
  },
  {
    question: 'How should a team test multi-tenant isolation during an evaluation?',
    answer:
      'Use a tenant-scoped dataset with recognizably different fixture data. Query without trusted tenant context, try to send another tenant in request input, and request a field that is not exposed. The safe result is rejection before SQL runs.',
  },
];

export default function EmbeddedAnalyticsTypeScriptPage() {
  const breadcrumbs = [
    { label: 'Home', href: '/' },
    { label: 'Compare', href: '/compare' },
    { label: 'Embedded analytics for TypeScript teams' },
  ];

  return (
    <HubShell
      path={PATH}
      breadcrumbs={breadcrumbs}
      eyebrow="TypeScript buyer's guide"
      title="Compare embedded analytics on governance, not the demo"
      updated={UPDATED}
      lead={
        <p>
          For a TypeScript team, the decisive question is not which product renders a chart fastest. It is where metric
          definitions and tenant rules live, whether every consumer uses them, and how safely they change.
        </p>
      }
      primaryCta={{ href: '#checklist', label: 'Use the checklist', target: 'typescript_buyer_checklist' }}
      secondaryCta={{ href: '#architectures', label: 'Compare architectures', target: 'typescript_buyer_architectures' }}
      definition={{
        term: 'What should TypeScript teams look for in embedded analytics?',
        body: (
          <p>
            Choose an architecture that gives metrics, dimensions and tenant rules one source of truth; makes database
            and API types visible to TypeScript; and serves the same definitions to dashboards, APIs and AI agents. Use
            an embedded BI tool when speed and customer self-service matter most, a standalone semantic layer when many
            tools need one model, and a code-first layer when product engineers own the analytics experience in the
            application repository.
          </p>
        ),
      }}
      jsonLd={[
        breadcrumbJsonLd(breadcrumbs, PATH),
        techArticleJsonLd({ path: PATH, headline: TITLE, description: DESCRIPTION, datePublished: PUBLISHED, dateModified: UPDATED }),
        faqJsonLd(faqItems),
      ]}
    >
      <HubSection
        id="architectures"
        eyebrow="Architecture first"
        title="Five ways to assemble embedded analytics"
        intro={
          <p>
            “Build or buy” is not one binary choice. You can buy the metric layer and build the UI, bring your own
            components to a hosted builder, or embed a finished BI experience. Compare the ownership boundary before
            comparing features.
          </p>
        }
      >
        <HubTable
          caption="Embedded analytics architectures for TypeScript teams"
          columns={['Architecture', 'Where governance lives', 'Metric consistency', 'UI ownership', 'Best fit']}
          rows={architectureRows}
        />
      </HubSection>

      <HubSection
        id="checklist"
        band
        eyebrow="Evaluation checklist"
        title="Ask for proof, not a yes-or-no feature answer"
        intro={
          <p>
            Run the same small evaluation against every option. Written answers are useful; a failed unsafe request and
            a successful cross-surface metric change are much stronger evidence.
          </p>
        }
      >
        <HubTable
          caption="Governance and metric-consistency evaluation checklist"
          columns={['Criterion', 'What good looks like', 'Proof to request']}
          rows={checklistRows}
        />
      </HubSection>

      <HubSection
        eyebrow="Weighted decision"
        title="Score the risks that are expensive to reverse"
        intro={
          <p>
            A useful default gives half the score to metric consistency and tenant isolation. Adjust the weights before
            demos begin, so an attractive editor or chart library cannot silently replace the requirements that brought
            the team to the evaluation.
          </p>
        }
      >
        <HubTable
          caption="Suggested embedded analytics evaluation weights"
          columns={['Area', 'Suggested weight', 'Question']}
          rows={scoreRows}
        />
      </HubSection>

      <HubSection
        band
        eyebrow="A two-hour proof"
        title="One metric, two tenants, three consumers"
        intro={
          <>
            <p>
              Use a real metric with one non-trivial rule, such as net revenue excluding refunds. Load two tenants with
              visibly different totals. Expose the metric to a dashboard, an HTTP request and, if relevant, an agent
              tool.
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>Confirm all three consumers return the same value for tenant A.</li>
              <li>Change the metric definition once and confirm all three values move together.</li>
              <li>Remove tenant context and verify the request fails instead of returning both tenants.</li>
              <li>Try to send tenant B from request input while authenticated as tenant A; verify it is rejected.</li>
              <li>Inspect the generated query, logs and metric version, then roll the change back.</li>
            </ol>
            <p>
              If a product cannot demonstrate this path, treat “governed metrics” and “multi-tenant” as unverified. For
              the database-level isolation choices underneath the tool, use the{' '}
              <Link href="/blog/embedded-analytics-clickhouse-multi-tenant-dashboards" className={inlineLink}>
                multi-tenant embedded analytics guide
              </Link>
              .
            </p>
          </>
        }
      />

      <HubSection
        eyebrow="Shortlist"
        title="Apply the checklist to real platforms"
        intro={
          <p>
            The companion comparison groups twelve current tools by architecture and records their embedding method,
            tenant model, ClickHouse support, self-hosting and pricing. Use this guide to set the criteria, then use the
            dated vendor comparison to build the shortlist.
          </p>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Link href="/compare/embedded-analytics-platforms" className={marketing.card}>
            <h3 className={marketing.cardTitle}>Compare 12 platforms</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Code-first layers, embedded BI platforms and BI tools with embedding, checked against vendor sources.
            </p>
          </Link>
          <Link href="/embedded-analytics" className={marketing.card}>
            <h3 className={marketing.cardTitle}>Build versus buy</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Decide who draws the charts, where metrics live and what customer self-service you need.
            </p>
          </Link>
          <Link href="/semantic-layer/ai-agents" className={marketing.card}>
            <h3 className={marketing.cardTitle}>Evaluate agent access</h3>
            <p className="mt-3 text-sm leading-6 text-text-muted">
              Named metrics, no raw SQL tool, trusted tenant scope and bounded queries over MCP.
            </p>
          </Link>
        </div>
      </HubSection>

      <HubSection band eyebrow="Questions" title="Embedded analytics evaluation FAQ">
        <HubFaq items={faqItems} />
      </HubSection>
    </HubShell>
  );
}
