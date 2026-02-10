import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';
import { DynamicCodeBlock } from 'fumadocs-ui/components/dynamic-codeblock';
import {
  CodeBlockTab,
  CodeBlockTabs,
  CodeBlockTabsList,
  CodeBlockTabsTrigger,
} from 'fumadocs-ui/components/codeblock';

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
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(99,102,241,0.2),transparent_34%),radial-gradient(circle_at_84%_2%,rgba(14,165,233,0.16),transparent_34%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              Use Case
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Multi-tenant SaaS analytics with policy control by default
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              Resolve auth context once, enforce tenant filtering automatically, and keep
              role checks in query definitions where teams can review and version them.
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
              <h2 className="text-lg font-semibold text-slate-100">Map auth once</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Convert API keys or sessions into typed auth context with tenant and role metadata.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-slate-100">Inject tenant filters</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Configure extraction once and let query execution scope data automatically.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold text-slate-100">Enforce roles inline</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Require admin or tenant-specific roles directly in sensitive query definitions.
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
          <h2 className="text-2xl font-semibold text-gray-100">Tenant auth without glue code</h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            Use API key auth and map tenant and admin identities directly into typed auth context.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="auth">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="auth">auth.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="auth" title="auth.ts">
              <DynamicCodeBlock
                lang="ts"
                code={authCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="text-2xl font-semibold text-gray-100">Automatic tenant scoping</h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            Set tenant extraction once and let HypeQuery inject filters automatically.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="tenant">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="tenant">api.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="tenant" title="api.ts">
              <DynamicCodeBlock
                lang="ts"
                code={tenantCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="text-2xl font-semibold text-gray-100">Role-based access for sensitive queries</h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            Apply access control directly in query definitions.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="rbac">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="rbac">queries.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="rbac" title="queries.ts">
              <DynamicCodeBlock
                lang="ts"
                code={roleCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <div className="border border-indigo-500/35 bg-[linear-gradient(140deg,rgba(30,41,59,0.9),rgba(15,23,42,0.95))] p-8 md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Governance outcome
              </p>
              <h2 className="mt-3 text-2xl font-semibold text-white">
                Clear tenant boundaries with a single shared query layer
              </h2>
              <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-300">
                <li>Clear admin versus tenant capabilities</li>
                <li>Reusable auth and policy primitives</li>
                <li>Faster onboarding for new product teams</li>
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
