import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse Multi-Tenant Analytics',
  description:
    'Build multi-tenant analytics on ClickHouse with automatic tenant scoping, typed APIs, and reusable query definitions that reduce data-leak risk.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-multi-tenant-analytics'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/clickhouse-multi-tenant-analytics'),
    title: 'ClickHouse Multi-Tenant Analytics | Tenant Isolation for SaaS',
    description:
      'Use auto-injected tenant filters and shared analytics definitions to build safer ClickHouse SaaS products.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse Multi-Tenant Analytics | Tenant Isolation for SaaS',
    description:
      'Use auto-injected tenant filters and shared analytics definitions to build safer ClickHouse SaaS products.',
  },
};

const tenantCode = `const { query, serve } = initServe({
  auth: authStrategy,
  tenant: {
    extract: (auth) => auth.tenantId,
    column: 'organization_id',
    mode: 'auto-inject',
    required: true,
  },
  context: () => ({ db }),
});`;

const queryCode = `const accountRevenue = query({
  query: ({ ctx }) =>
    ctx.db
      .table('orders')
      .sum('amount', 'revenue')
      .execute(),
});`;

export default function ClickHouseMultiTenantAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Multi-Tenant Analytics"
      title="Build multi-tenant ClickHouse analytics without trusting every query author"
      description="SaaS analytics breaks when tenant isolation is a convention instead of a system property. hypequery lets you inject tenant filters automatically so reusable ClickHouse queries stay safely scoped across APIs, dashboards, and internal tooling."
      primaryCta={{ href: '/docs/multi-tenancy', label: 'Open multi-tenancy docs' }}
      secondaryCta={{ href: '/app/use-cases/multi-tenant-saas', label: 'See the SaaS use case' }}
      stats={[
        { label: 'Isolation mode', value: 'Auto-inject filters' },
        { label: 'Best fit', value: 'B2B SaaS analytics' },
        { label: 'Primary risk solved', value: 'Cross-tenant leakage' },
      ]}
      problems={[
        {
          title: 'Manual tenant filters fail under team growth',
          copy:
            'Once multiple engineers touch analytics code, someone eventually forgets `WHERE organization_id = ...`. A convention is not a security control.',
        },
        {
          title: 'Multi-context reuse increases leak risk',
          copy:
            'The same query may serve product dashboards, internal ops tools, and external APIs. Every extra consumer multiplies the chance of a scoping mistake.',
        },
        {
          title: 'SaaS teams still need analytics ergonomics',
          copy:
            'You need strong tenant isolation without losing reusable query definitions, typed APIs, or React integration. Security cannot require giving up developer speed.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Safer default',
        title: 'Let the framework apply tenant scoping before the query runs',
        description:
          'hypequery supports tenant-aware query execution by extracting a tenant from auth context and auto-injecting filters into every query builder in your context.',
        bullets: [
          'Extract tenant identity from your auth strategy',
          'Auto-inject tenant filters into reusable query builders',
          'Reject requests without valid tenant context when required',
          'Keep named analytics queries reusable across APIs and UI',
          'Reduce the odds of cross-tenant exposure during feature growth',
        ],
        codePanel: {
          eyebrow: 'Serve config',
          title: 'Configure tenant scoping once',
          description:
            'This is the important architectural move: tenant enforcement belongs in the runtime layer, not as a repeated code-review checklist item.',
          code: tenantCode,
        },
      }}
      implementationSection={{
        eyebrow: 'What changes for query authors',
        title: 'Queries stay simple because isolation happens underneath them',
        description:
          'Once tenant scoping is configured, query authors can write normal analytics logic. The framework ensures the underlying ClickHouse access is constrained to the authenticated tenant.',
        paragraphs: [
          'That matters most in product analytics, where the same base queries are often reused across many dashboard cards and endpoint variants.',
          'If your broader concern is the architecture of a reusable analytics layer, step out to the ClickHouse analytics pillar after this page.',
        ],
        codePanel: {
          eyebrow: 'Query authoring',
          title: 'Write the query, not the isolation boilerplate',
          description:
            'The query stays focused on the metric. Tenant filtering is enforced by the surrounding runtime configuration.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse multi-tenant SaaS analytics',
          copy:
            'If you run one ClickHouse cluster for many customers, your main design problem is governed query access, not just raw SQL performance.',
        },
        {
          title: 'Tenant isolation in analytics APIs',
          copy:
            'A secure analytics API should derive tenant scope from auth context and enforce it centrally rather than relying on every handler to remember a filter.',
        },
        {
          title: 'Preventing data leaks in shared dashboards',
          copy:
            'Dashboard reuse is where accidental cross-tenant leakage often happens. Shared query definitions need runtime scoping built in.',
        },
        {
          title: 'Scaling B2B analytics features safely',
          copy:
            'As teams add exports, customer-facing charts, and internal tooling, the value of automatic tenant controls rises sharply.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/multi-tenancy',
          title: 'Multi-tenancy documentation',
          description: 'The detailed configuration guide for tenant extraction and auto-injection.',
        },
        {
          href: '/app/use-cases/multi-tenant-saas',
          title: 'Multi-tenant SaaS use case',
          description: 'See how the product use case is framed for teams evaluating hypequery.',
        },
        {
          href: '/blog/the-analytics-language-layer-why-real-time-data-needs-typed-apis-not-just-faster-databases',
          title: 'Why real-time data needs typed APIs',
          description: 'The architectural argument for a governed analytics layer.',
        },
        {
          href: '/clickhouse-analytics',
          title: 'ClickHouse analytics',
          description: 'Move from tenant isolation specifics to the wider analytics-layer pattern.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-analytics', label: 'ClickHouse Analytics' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Design tenant controls first, then add product-facing dashboards on top',
        description:
          'The cheapest time to make tenant isolation automatic is before analytics queries spread through your codebase and across product surfaces.',
        primaryCta: { href: '/docs/multi-tenancy', label: 'Open tenant docs' },
        secondaryCta: { href: '/clickhouse-analytics', label: 'Read analytics architecture' },
      }}
    />
  );
}
