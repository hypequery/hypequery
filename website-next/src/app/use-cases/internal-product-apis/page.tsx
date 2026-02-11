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

const routesCode = `import { createFetchHandler } from '@hypequery/serve';

const hypequeryHandler = createFetchHandler(api.handler);
app.route('/api/products', products);
app.all('/internal/hq/*', (c) => hypequeryHandler(c.req.raw));`;

const composeCode = `const productId = c.req.param('productId').toUpperCase();
const analytics = await api.run('productOverview', {
  productId,
});

return c.json({ productId, analytics });`;

const defineOnceCode = `const serve = initServe({
  context: () => ({ db }),
});

export const api = serve.define({
  basePath: '/internal/hq',
  queries: serve.queries({
    topProducts: query
      .output(z.array(z.object({
        product_id: z.string(),
        avg_order_value: z.number(),
      })))
      .query(({ ctx }) =>
        ctx.db
          .table('analytics.orders')
          .select(['payment_type as product_id'])
          .count('trip_id', 'orders')
          .avg('order_total', 'avg_order_value')
          .groupBy(['payment_type'])
          .execute()
      ),
  }),
});`;

export default function InternalProductApisUseCasePage() {
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(59,130,246,0.2),transparent_36%),radial-gradient(circle_at_82%_0%,rgba(14,165,233,0.14),transparent_32%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
              Use Case
            </p>
            <h1 className="font-display mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Internal product APIs with embedded analytics
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              Layer type-safe analytics into the backend you already run. Keep product
              routes stable while exposing analytics under an internal namespace.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                href="/docs/quick-start"
                className="bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Start with this pattern
              </Link>
              <a
                href="https://cal.com"
                className="border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                target="_blank"
                rel="noopener noreferrer"
              >
                Book architecture chat
              </a>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Contract impact</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Zero endpoint breakage</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Execution model</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">In-process + routed</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Migration style</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">Endpoint-by-endpoint</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="grid gap-6 md:grid-cols-3">
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">Keep route contracts stable</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Existing API consumers keep working while analytics ships behind internal paths.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">Use one query definition</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Call analytics from handlers with <code>api.run(...)</code> and expose the same logic via HTTP.
              </p>
            </div>
            <div className="border border-slate-700 bg-slate-900/60 p-6">
              <h2 className="font-display text-lg font-semibold text-slate-100">Scale rollout safely</h2>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Start with one endpoint, validate outcomes, then expand into a broader internal API surface.
              </p>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
            <h2 className="font-display text-3xl font-semibold text-white">Implementation flow</h2>
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Step 1</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-slate-100">Mount internal routes</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Add HypeQuery under a dedicated internal namespace beside current handlers.
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Step 2</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-slate-100">Compose in endpoints</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Pull analytics into product responses directly from business endpoints.
                </p>
              </div>
              <div className="border border-slate-700 bg-slate-900/70 p-6">
                <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">Step 3</p>
                <h3 className="font-display mt-3 text-lg font-semibold text-slate-100">Reuse query logic</h3>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  Keep one typed source of truth for both in-process and routed analytics execution.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <h2 className="font-display text-2xl font-semibold text-gray-100">Works with your existing routes</h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            Your backend stays in control. Mount HypeQuery routes where you want
            them.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="routes">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="routes">routes.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="routes" title="routes.ts">
              <DynamicCodeBlock
                lang="ts"
                code={routesCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="font-display text-2xl font-semibold text-gray-100">
            Compose analytics directly in business endpoints
          </h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            Use <code>api.run(...)</code> from existing handlers whenever product
            responses need analytics context.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="compose">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="compose">products.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="compose" title="products.ts">
              <DynamicCodeBlock
                lang="ts"
                code={composeCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <h2 className="font-display text-2xl font-semibold text-gray-100">
            Define once, reuse everywhere
          </h2>
          <p className="mt-3 text-lg leading-8 text-gray-300">
            The same query definitions can power internal HTTP routes and
            in-process calls.
          </p>
          <CodeBlockTabs className="mt-6 rounded-none" defaultValue="api">
            <CodeBlockTabsList>
              <CodeBlockTabsTrigger value="api">analytics/api.ts</CodeBlockTabsTrigger>
            </CodeBlockTabsList>
            <CodeBlockTab value="api" title="analytics/api.ts">
              <DynamicCodeBlock
                lang="ts"
                code={defineOnceCode}
                codeblock={{ className: 'hq-codeblock hq-highlight text-sm' }}
              />
            </CodeBlockTab>
          </CodeBlockTabs>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 lg:px-6">
          <div className="border border-indigo-500/35 bg-[linear-gradient(130deg,rgba(30,41,59,0.9),rgba(15,23,42,0.95))] p-8 md:flex md:items-center md:justify-between md:gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Ready to implement
              </p>
              <h2 className="font-display mt-3 text-2xl font-semibold text-white">
                Use this as your first production migration path
              </h2>
              <ul className="mt-4 space-y-2 text-sm leading-7 text-slate-300">
                <li>Keep existing consumer contracts intact</li>
                <li>Move analytics logic into typed definitions</li>
                <li>Expand exposure only when your team is ready</li>
              </ul>
            </div>
            <div className="mt-6 flex gap-3 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-indigo-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Open quick start
              </Link>
              <Link
                href="/use-cases/multi-tenant-saas"
                className="inline-flex items-center border border-slate-600 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-800"
              >
                Next: Multi-tenant
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
