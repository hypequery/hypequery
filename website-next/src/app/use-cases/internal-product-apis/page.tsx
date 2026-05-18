import type { Metadata } from 'next';
import Link from 'next/link';
import PageWrapper from '@/components/PageWrapper';
import CodeWindow from '@/components/CodeWindow';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Internal Product APIs with ClickHouse Analytics',
  description:
    'Add ClickHouse analytics to the backend you already run without rewriting your public API surface first.',
  alternates: {
    canonical: absoluteUrl('/use-cases/internal-product-apis'),
  },
  openGraph: {
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
        <section className="relative overflow-hidden border-b border-border">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
              Use Case
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-text sm:text-6xl">
              Internal product APIs with embedded ClickHouse analytics
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-text-muted">
              This is the migration path for teams that already have a backend and do not want to split it into a separate analytics service on day one. Keep the existing routes, move the query logic onto a shared path, and expose more only when it earns its place.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                className="bg-text px-6 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Start with this pattern
              </Link>
              <a
                href="https://cal.com"
                className="border border-border-strong px-6 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
                target="_blank"
                rel="noopener noreferrer"
              >
                Book architecture chat
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Contract impact</p>
                <p className="mt-2 text-xl font-semibold text-text">Zero endpoint breakage</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Execution model</p>
                <p className="mt-2 text-xl font-semibold text-text">In-process + routed</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Migration style</p>
                <p className="mt-2 text-xl font-semibold text-text">Endpoint-by-endpoint</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 md:grid-cols-3">
	            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
	              <h2 className="font-display text-lg font-semibold text-text">Keep route contracts stable</h2>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Existing consumers do not need to notice the migration while you move analytics logic behind an internal path.
	              </p>
	            </div>
	            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
	              <h2 className="font-display text-lg font-semibold text-text">Use one query definition</h2>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Let handlers call `api.run(...)` directly and expose the same definition over HTTP only where it is genuinely useful.
	              </p>
	            </div>
	            <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
	              <h2 className="font-display text-lg font-semibold text-text">Scale rollout safely</h2>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Start with one endpoint or one response shape, see what sticks, then widen the internal surface deliberately.
	              </p>
	            </div>
          </div>
        </section>

        <section className="border-y border-border bg-bg-alt/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <h2 className="font-display text-3xl font-semibold text-text">Implementation flow</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-accent">Step 1</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-text">Mount internal routes</h3>
	                <p className="mt-3 text-sm leading-7 text-text-muted">
	                  Mount the analytics handler beside the routes you already run instead of restructuring the whole backend first.
	                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-accent">Step 2</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-text">Compose in endpoints</h3>
	                <p className="mt-3 text-sm leading-7 text-text-muted">
	                  Pull analytics into existing business responses without turning every route into bespoke query code.
	                </p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-6 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-accent">Step 3</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-text">Reuse query logic</h3>
	                <p className="mt-3 text-sm leading-7 text-text-muted">
	                  Keep one typed source of truth whether the query is called directly or exposed under an internal path.
	                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
	          <h2 className="font-display text-2xl font-semibold text-text">Works with your existing routes</h2>
	          <p className="mt-3 text-lg leading-8 text-text-muted">
	            The route tree stays yours. Add the analytics surface where it fits instead of adopting a separate service boundary immediately.
	          </p>
          <CodeWindow code={routesCode} filename="routes.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="font-display text-2xl font-semibold text-text">
            Compose analytics directly in business endpoints
          </h2>
	          <p className="mt-3 text-lg leading-8 text-text-muted">
	            Use `api.run(...)` when a product response needs analytics context but does not need another network hop inside the same backend.
	          </p>
          <CodeWindow code={composeCode} filename="products.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="font-display text-2xl font-semibold text-text">
            Define once, reuse everywhere
          </h2>
	          <p className="mt-3 text-lg leading-8 text-text-muted">
	            The same definition can back an internal route and an in-process call, which is the whole point of this adoption path.
	          </p>
          <CodeWindow code={defineOnceCode} filename="analytics/api.ts" className="mt-6" />
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                Ready to implement
              </p>
	              <h2 className="font-display mt-3 text-2xl font-semibold text-text">
	                Use this as your first production migration path
	              </h2>
	              <ul className="mt-4 space-y-2 text-sm leading-7 text-text-muted">
	                <li>Keep existing consumer contracts intact</li>
	                <li>Move the query logic into one typed definition</li>
	                <li>Expose more surface area only when the team actually needs it</li>
	              </ul>
	            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-text px-5 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Open quick start
              </Link>
              <Link
                href="/use-cases/multi-tenant-saas"
                className="inline-flex items-center border border-border-strong px-5 py-3 text-sm font-semibold text-text transition hover:bg-bg-alt"
              >
                Next: Multi-tenant
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
