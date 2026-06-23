import type { Metadata } from 'next';
import Link from 'next/link';
import PageWrapper from '@/components/PageWrapper';
import { absoluteUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'hypequery Use Cases',
  description:
    'See the two main ways teams adopt hypequery: adding analytics to existing product APIs or shipping tenant-scoped SaaS analytics on ClickHouse.',
  alternates: {
    canonical: absoluteUrl('/use-cases'),
  },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/use-cases'),
    title: 'hypequery Use Cases | Type-Safe ClickHouse Analytics',
    description:
      'The two main adoption paths: add analytics to an existing backend or ship tenant-scoped SaaS analytics on ClickHouse.',
  },
};

const useCases = [
  {
    href: '/use-cases/internal-product-apis',
    label: 'Internal Product APIs',
    title: 'Add analytics to existing product endpoints',
    description:
      'Keep your route contracts stable and compose analytics directly inside business handlers.',
    points: [
      'No forced service split',
      'Reuse query definitions in-process and over HTTP',
      'Roll out incrementally by endpoint',
    ],
  },
  {
    href: '/use-cases/multi-tenant-saas',
    label: 'Multi-tenant SaaS',
    title: 'Ship tenant-aware analytics APIs by default',
    description:
      'Resolve auth context once, inject tenant filters automatically, and enforce role checks in query definitions.',
    points: [
      'Tenant isolation without custom middleware sprawl',
      'Role checks live next to query logic',
      'Scales from early-stage to enterprise tenancy models',
    ],
  },
];

export default function UseCasesPage() {
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
    ],
  };

  return (
    <PageWrapper>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }} />
        <section className="relative overflow-hidden border-b border-border">
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent">
              Use Cases
            </p>
            <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight text-text sm:text-6xl">
              ClickHouse analytics use cases for product APIs and SaaS
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-text-muted">
              These are the two adoption paths that show up most often: teams layering analytics into an existing backend, and teams shipping customer-facing analytics with tenant boundaries that need to hold up in production.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Adoption path</p>
                <p className="mt-2 text-2xl font-semibold text-text">Incremental</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Source of truth</p>
                <p className="mt-2 text-2xl font-semibold text-text">Typed queries</p>
              </div>
              <div className="rounded-lg border border-border bg-bg-card p-5 shadow-card">
                <p className="text-xs uppercase tracking-[0.2em] text-text-dim">Runtime model</p>
                <p className="mt-2 text-2xl font-semibold text-text">In-process or HTTP</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
            Use Cases
          </p>
          <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-text sm:text-4xl">
            Start with the path closest to the codebase you already have
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {useCases.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-lg border border-border bg-bg-card p-8 transition duration-200 hover:-translate-y-1 hover:border-border-strong hover:shadow-card"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
                  {item.label}
                </p>
                <h3 className="font-display mt-3 text-2xl font-semibold text-text">{item.title}</h3>
                <p className="mt-4 text-base leading-7 text-text-muted">{item.description}</p>
                <ul className="mt-6 space-y-2 text-sm text-text">
                  {item.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
	                <p className="mt-7 text-sm font-semibold uppercase tracking-[0.2em] text-accent transition group-hover:opacity-70">
	                  Open use case
	                </p>
	              </Link>
	            ))}
	          </div>
	        </section>

	        <section className="border-y border-border bg-bg-alt/60">
	          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 lg:grid-cols-3 lg:px-6">
	            <div>
	              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Step 01</p>
	              <h3 className="font-display mt-3 text-xl font-semibold text-text">Pick one repeated query</h3>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Start with analytics logic that already appears in more than one place in your codebase.
	              </p>
	            </div>
	            <div>
	              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Step 02</p>
	              <h3 className="font-display mt-3 text-xl font-semibold text-text">Put it on a shared path</h3>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Either call it in-process from the backend you already run or expose it under a controlled internal API path.
	              </p>
	            </div>
	            <div>
	              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-text-dim">Step 03</p>
	              <h3 className="font-display mt-3 text-xl font-semibold text-text">Expand only after it proves useful</h3>
	              <p className="mt-3 text-sm leading-7 text-text-muted">
	                Let more consumers depend on the same definition instead of minting new one-off query copies.
	              </p>
	            </div>
	          </div>
	        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="rounded-lg border border-border-strong bg-bg-card p-8 shadow-card md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
                Next step
              </p>
	              <h3 className="font-display mt-3 text-2xl font-semibold text-text">
	                Start with the use case closest to your current architecture
	              </h3>
	              <p className="mt-3 max-w-2xl text-sm leading-7 text-text-muted">
	                Do not start by adopting everything at once. Pick the path that matches your existing backend shape and replace one real query first.
	              </p>
	            </div>
            <div className="mt-6 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-text px-6 py-3 text-sm font-semibold text-bg transition hover:opacity-90"
              >
                Open quick start
              </Link>
            </div>
          </div>
        </section>
    </PageWrapper>
  );
}
