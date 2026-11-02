import type { Metadata } from 'next';
import Link from 'next/link';
import { marketing } from '@/components/ui/marketing';
import PageWrapper from '@/components/PageWrapper';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Internal Product APIs with ClickHouse Analytics',
  description:
    'Add ClickHouse analytics to the backend you already run without rewriting your public API surface first.',
  alternates: {
    canonical: absoluteUrl('/use-cases/internal-product-apis'),
  },
  openGraph: {
    images: ogImage('Internal Product APIs with ClickHouse Analytics'),
    type: 'website',
    url: absoluteUrl('/use-cases/internal-product-apis'),
    title: 'Internal Product APIs with ClickHouse Analytics | hypequery',
    description:
      'Keep your existing backend routes and move repeated analytics logic onto one shared ClickHouse query path.',
  },
};

const routesCode = `import { createFetchHandler } from '@hypequery/serve';

const hypequeryHandler = createFetchHandler(api.handler);
app.route('/api/products', products);
app.all('/internal/hq/*', (c) => hypequeryHandler(c.req.raw));`;

const composeCode = `const productId = c.req.param('productId').toUpperCase();
const analytics = await api.run('productOverview', {
  productId,
});

return c.json({ productId, analytics });`;

const defineOnceCode = `const { query, serve } = initServe({
  context: () => ({ db }),
});

const topProducts = query({
  output: z.array(z.object({
    product_id: z.string(),
    avg_order_value: z.number(),
  })),
  query: ({ ctx }) =>
    ctx.db
      .table('analytics.orders')
      .select(['payment_type as product_id'])
      .count('trip_id', 'orders')
      .avg('order_total', 'avg_order_value')
      .groupBy(['payment_type'])
      .execute(),
});

export const api = serve({
  basePath: '/internal/hq',
  queries: { topProducts },
});`;

export default function InternalProductApisUseCasePage() {
  const pageUrl = absoluteUrl('/use-cases/internal-product-apis').toString();
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
        name: 'Internal Product APIs',
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
              Internal product APIs with embedded ClickHouse analytics
            </h1>
            <p className={`mt-5 max-w-[700px] ${marketing.heroLead}`}>
              This is the migration path for teams that already have a backend and do not want to split it into a separate analytics service on day one. Keep the existing routes, move the query logic onto a shared path, and expose more only when it earns its place.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="hero_primary"
                className={marketing.primaryButton}
              >
                Start with this pattern
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
                Book architecture chat
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Contract impact</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Zero endpoint breakage</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Execution model</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">In-process + routed</p>
              </div>
              <div className="rounded-xl border border-border bg-bg-card p-5 shadow-card">
                <p className="font-mono text-xs text-text-dim">Migration style</p>
                <p className="mt-2 text-lg font-medium tracking-tight text-text">Endpoint-by-endpoint</p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
          <div className="grid gap-6 md:grid-cols-3">
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Keep route contracts stable</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Existing consumers do not need to notice the migration while you move analytics logic behind an internal path.
	              </p>
	            </div>
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Use one query definition</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Let handlers call `api.run(...)` directly and expose the same definition over HTTP only where it is genuinely useful.
	              </p>
	            </div>
	            <div className={marketing.card}>
	              <h2 className="text-lg font-medium tracking-tight text-text">Scale rollout safely</h2>
	              <p className="mt-3 text-sm leading-6 text-text-muted">
	                Start with one endpoint or one response shape, see what sticks, then widen the internal surface deliberately.
	              </p>
	            </div>
          </div>
        </section>

        <section className={marketing.band}>
          <div className={`${marketing.container} py-14 sm:py-20`}>
          <h2 className={marketing.sectionTitle}>Implementation flow</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div className={marketing.card}>
                <p className={marketing.eyebrow}>Step 1</p>
                <h3 className="mt-3 text-lg font-medium tracking-tight text-text">Mount internal routes</h3>
	                <p className="mt-3 text-sm leading-6 text-text-muted">
	                  Mount the analytics handler beside the routes you already run instead of restructuring the whole backend first.
	                </p>
              </div>
              <div className={marketing.card}>
                <p className={marketing.eyebrow}>Step 2</p>
                <h3 className="mt-3 text-lg font-medium tracking-tight text-text">Compose in endpoints</h3>
	                <p className="mt-3 text-sm leading-6 text-text-muted">
	                  Pull analytics into existing business responses without turning every route into bespoke query code.
	                </p>
              </div>
              <div className={marketing.card}>
                <p className={marketing.eyebrow}>Step 3</p>
                <h3 className="mt-3 text-lg font-medium tracking-tight text-text">Reuse query logic</h3>
	                <p className="mt-3 text-sm leading-6 text-text-muted">
	                  Keep one typed source of truth whether the query is called directly or exposed under an internal path.
	                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={`${marketing.container} py-14 sm:py-20`}>
	          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">Works with your existing routes</h2>
	          <p className="mt-3 text-body text-text-muted">
	            The route tree stays yours. Add the analytics surface where it fits instead of adopting a separate service boundary immediately.
	          </p>
          <CodeWindow code={routesCode} filename="routes.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">
            Compose analytics directly in business endpoints
          </h2>
	          <p className="mt-3 text-body text-text-muted">
	            Use `api.run(...)` when a product response needs analytics context but does not need another network hop inside the same backend.
	          </p>
          <CodeWindow code={composeCode} filename="products.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <h2 className="text-2xl font-normal tracking-[-0.03em] text-text">
            Define once, reuse everywhere
          </h2>
	          <p className="mt-3 text-body text-text-muted">
	            The same definition can back an internal route and an in-process call, which is the whole point of this adoption path.
	          </p>
          <CodeWindow code={defineOnceCode} filename="analytics/api.ts" className="mt-6" />
        </section>

        <section className={`${marketing.container} pb-14 sm:pb-20`}>
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className={marketing.eyebrow}>
                Ready to implement
              </p>
	              <h2 className="mt-3 text-2xl font-normal tracking-[-0.03em] text-text">
	                Use this as your first production migration path
	              </h2>
	              <ul className="mt-4 space-y-2 text-sm leading-6 text-text-muted">
	                <li>Keep existing consumer contracts intact</li>
	                <li>Move the query logic into one typed definition</li>
	                <li>Expose more surface area only when the team actually needs it</li>
	              </ul>
	            </div>
            <div className="mt-6 flex shrink-0 flex-wrap gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                data-umami-event="cta_click"
                data-umami-event-target="docs_quick_start"
                data-umami-event-location="next_step_primary"
                className={marketing.primaryButton}
              >
                Open quick start
              </Link>
              <Link
                href="/use-cases/multi-tenant-saas"
                data-umami-event="cta_click"
                data-umami-event-target="use_cases_multi_tenant_saas"
                data-umami-event-location="next_step_secondary"
                className={marketing.secondaryButton}
              >
                Next: Multi-tenant
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
