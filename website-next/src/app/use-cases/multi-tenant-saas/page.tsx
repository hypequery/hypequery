import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Multi-Tenant SaaS Analytics on ClickHouse',
  description:
    'Build customer-facing ClickHouse analytics with tenant scoping and role checks that live in one reviewable backend path.',
  alternates: {
    canonical: absoluteUrl('/use-cases/multi-tenant-saas'),
  },
  openGraph: {
    images: ogImage('Multi-Tenant SaaS Analytics on ClickHouse'),
    type: 'website',
    url: absoluteUrl('/use-cases/multi-tenant-saas'),
    title: 'Multi-Tenant SaaS Analytics on ClickHouse | hypequery',
    description:
      'Use one reviewable backend path for tenant-scoped, customer-facing ClickHouse analytics.',
  },
};

const authCode = `import { createApiKeyStrategy, createAuthSystem } from '@hypequery/serve';

const { useAuth, TypedAuth } = createAuthSystem({
  defaultAuth: { authenticated: false },
});

type AppAuth = typeof TypedAuth & { tenantId?: 'acme' | 'globex' };

export const authStrategy = createApiKeyStrategy<AppAuth>({
  validate: (key) => {
    if (key === 'acme-key') return { authenticated: true, tenantId: 'acme', roles: ['admin'] };
    if (key === 'globex-key') return { authenticated: true, tenantId: 'globex', roles: ['viewer'] };
    return { authenticated: false };
  },
});`;

const tenantCode = `const { define, query } = initServe({
  tenant: {
    extract: (ctx) => ctx.auth?.tenantId,
    column: 'tenant_id',
    required: false,
  },
  context: async () => ({ db }),
});`;

const roleCode = `revenueByPlan: query
  .describe('MRR by plan (admin only)')
  .requireRole('admin')
  .output(z.array(z.object({
    plan: z.string(),
    total_mrr: z.number(),
  })))
  .query(({ ctx }) =>
    ctx.db
      .table('analytics.subscription_mrr')
      .innerJoin(
        'analytics.users',
        'analytics.users.user_id',
        'analytics.subscription_mrr.user_id',
      )
      .sum('mrr', 'total_mrr')
      .groupBy(['plan'])
      .execute()
  )`;

export default function MultiTenantSaasUseCasePage() {
  const pageUrl = absoluteUrl('/use-cases/multi-tenant-saas').toString();
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Use Cases',
        item: absoluteUrl('/use-cases').toString(),
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Multi-tenant SaaS',
        item: pageUrl,
      },
    ],
  };

  return (
    <PageWrapper>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <section className="border-b border-border">
          <div className={`${marketing.container} pb-14 pt-12 sm:pb-16 sm:pt-16`}>
            <p className={marketing.eyebrow}>
              Use Case
            </p>
            <h1 className={`mt-5 max-w-[980px] ${marketing.heroTitle}`}>
              Multi-tenant SaaS ClickHouse analytics with policy control by default
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              This is the path for teams whose analytics already reach customers. The goal is not only faster queries. It is a backend path where tenant scope and role checks stop being easy to forget.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/multi-tenancy"
                data-umami-event="cta_click"
                data-umami-event-target="docs_multi_tenancy"
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                Start with multi-tenancy docs
              </Link>
              <a
                href="https://cal.com/luke-reilly-jdi9su/hypequery-chat"
                data-umami-event="cta_click"
                data-umami-event-target="book_call"
                data-umami-event-location="hero_secondary"
                className={marketing.secondaryButton}
                target="_blank"
                rel="noopener noreferrer"
              >
                Review your auth model
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Tenancy mode</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Scoped automatically</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Policy location</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Inside query code</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Scale target</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">2 to 2000+ tenants</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-6 md:grid-cols-3">
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Map auth once</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Turn API keys or sessions into typed request context with tenant and role metadata in one place.
	              </p>
	            </div>
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Inject tenant filters</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Configure extraction once and let the standard query path apply tenant scope instead of trusting every author to remember it.
	              </p>
	            </div>
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Enforce roles inline</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Keep sensitive access checks next to the query definition instead of scattering them through route files.
	              </p>
	            </div>
          </div>
        </section>

        <section className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
            <h2 className={marketing.sectionTitle}>Request lifecycle</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className={marketing.eyebrow}>1</p>
                <p className="mt-3 text-sm text-text">Request arrives with API key/session.</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className={marketing.eyebrow}>2</p>
                <p className="mt-3 text-sm text-text">Auth strategy resolves tenant and roles.</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className={marketing.eyebrow}>3</p>
                <p className="mt-3 text-sm text-text">Tenant scope is injected into query execution.</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className={marketing.eyebrow}>4</p>
                <p className="mt-3 text-sm text-text">Role gates are enforced in definitions.</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className={marketing.eyebrow}>5</p>
                <p className="mt-3 text-sm text-text">Typed responses return safe tenant data.</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
	          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">Tenant auth without glue code</h2>
	          <p className="mt-3 text-body text-text-muted">
	            Map incoming auth to one typed context object so tenant and role data enter the system in a predictable way.
	          </p>
          <CodeWindow code={authCode} filename="auth.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
	          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">Automatic tenant scoping</h2>
	          <p className="mt-3 text-body text-text-muted">
	            Set tenant extraction once and let the backend query path apply it consistently rather than relying on repeated manual filters.
	          </p>
          <CodeWindow code={tenantCode} filename="api.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
	          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">Role-based access for sensitive queries</h2>
	          <p className="mt-3 text-body text-text-muted">
	            Put the access rule on the query definition that needs it instead of treating authorization as an afterthought outside the analytics layer.
	          </p>
          <CodeWindow code={roleCode} filename="queries.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className={marketing.eyebrow}>
                Governance outcome
              </p>
	              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
	                Clear tenant boundaries with a single shared query layer
	              </h2>
	              <ul className="mt-4 space-y-2 text-sm leading-6 text-text-muted">
	                <li>Clear admin versus tenant capabilities</li>
	                <li>Reusable auth and policy primitives</li>
	                <li>One reviewable backend path for customer-facing analytics</li>
	              </ul>
	            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href="/docs/multi-tenancy"
                data-umami-event="cta_click"
                data-umami-event-target="docs_multi_tenancy"
                data-umami-event-location="next_step_primary"
                className={marketing.primaryButton}
              >
                Open multi-tenancy docs
              </Link>
              <Link
                href="/use-cases/internal-product-apis"
                data-umami-event="cta_click"
                data-umami-event-target="use_cases_internal_product_apis"
                data-umami-event-location="next_step_secondary"
                className={marketing.secondaryButton}
              >
                Internal API pattern
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
