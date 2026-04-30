import type { Metadata } from 'next';
import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Multi-Tenant SaaS Analytics on ClickHouse',
  description:
    'Build customer-facing ClickHouse analytics with tenant scoping and role checks that live in one reviewable backend path.',
  alternates: {
    canonical: absoluteUrl('/use-cases/multi-tenant-saas'),
  },
  openGraph: {
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
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              Use Case
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Multi-tenant SaaS ClickHouse analytics with policy control by default
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              This is the path for teams whose analytics already reach customers. The goal is not only faster queries. It is a backend path where tenant scope and role checks stop being easy to forget.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/multi-tenancy"
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start with multi-tenancy docs
              </Link>
              <a
                href="https://cal.com"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                target="_blank"
                rel="noopener noreferrer"
              >
                Review your auth model
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Tenancy mode</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Scoped automatically</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Policy location</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Inside query code</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Scale target</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">2 to 2000+ tenants</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 md:grid-cols-3">
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Map auth once</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                Turn API keys or sessions into typed request context with tenant and role metadata in one place.
	              </p>
	            </div>
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Inject tenant filters</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                Configure extraction once and let the standard query path apply tenant scope instead of trusting every author to remember it.
	              </p>
	            </div>
	            <div className="border border-slate-700 bg-slate-900/60 p-6">
	              <h2 className="font-display text-lg font-semibold text-slate-100">Enforce roles inline</h2>
	              <p className="mt-3 text-sm leading-7 text-slate-300">
	                Keep sensitive access checks next to the query definition instead of scattering them through route files.
	              </p>
	            </div>
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <h2 className="font-display text-3xl font-semibold text-white">Request lifecycle</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-5">
              <div className="border border-slate-700 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">1</p>
                <p className="mt-3 text-sm text-slate-200">Request arrives with API key/session.</p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">2</p>
                <p className="mt-3 text-sm text-slate-200">Auth strategy resolves tenant and roles.</p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">3</p>
                <p className="mt-3 text-sm text-slate-200">Tenant scope is injected into query execution.</p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">4</p>
                <p className="mt-3 text-sm text-slate-200">Role gates are enforced in definitions.</p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">5</p>
                <p className="mt-3 text-sm text-slate-200">Typed responses return safe tenant data.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
	          <h2 className="font-display text-2xl font-semibold text-gray-100">Tenant auth without glue code</h2>
	          <p className="mt-3 text-lg leading-8 text-gray-300">
	            Map incoming auth to one typed context object so tenant and role data enter the system in a predictable way.
	          </p>
          <CodeWindow code={authCode} filename="auth.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
	          <h2 className="font-display text-2xl font-semibold text-gray-100">Automatic tenant scoping</h2>
	          <p className="mt-3 text-lg leading-8 text-gray-300">
	            Set tenant extraction once and let the backend query path apply it consistently rather than relying on repeated manual filters.
	          </p>
          <CodeWindow code={tenantCode} filename="api.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
	          <h2 className="font-display text-2xl font-semibold text-gray-100">Role-based access for sensitive queries</h2>
	          <p className="mt-3 text-lg leading-8 text-gray-300">
	            Put the access rule on the query definition that needs it instead of treating authorization as an afterthought outside the analytics layer.
	          </p>
          <CodeWindow code={roleCode} filename="queries.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <div className="border border-indigo-500/35 bg-slate-950 p-8 md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Governance outcome
              </p>
	              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
	                Clear tenant boundaries with a single shared query layer
	              </h2>
	              <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-300">
	                <li>Clear admin versus tenant capabilities</li>
	                <li>Reusable auth and policy primitives</li>
	                <li>One reviewable backend path for customer-facing analytics</li>
	              </ul>
	            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/multi-tenancy"
                className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Open multi-tenancy docs
              </Link>
              <Link
                href="/use-cases/internal-product-apis"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                Internal API pattern
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
