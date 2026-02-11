import Link from 'next/link';
import Navigation from '@/components/Navigation';
import Footer from '@/components/Footer';

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
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-[#020617] pt-28 text-gray-100">
        <section className="relative overflow-hidden border-b border-slate-800/80">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_15%,rgba(99,102,241,0.28),transparent_40%),radial-gradient(circle_at_82%_0%,rgba(14,165,233,0.22),transparent_34%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-20 lg:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-indigo-300">
              Use Cases
            </p>
            <h1 className="font-display mt-4 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              Product-ready analytics pages, not feature fragments
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              Start from your existing backend contracts, add type-safe analytics, and
              grow from internal use to external APIs without rewriting core logic.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Adoption path</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">Incremental</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Source of truth</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">Typed queries</p>
              </div>
              <div className="border border-slate-700/80 bg-slate-950/70 p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Runtime model</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">In-process or HTTP</p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-20 lg:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-300">
            Use Cases
          </p>
          <h2 className="font-display mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Pick the pattern that matches your architecture
          </h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {useCases.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group border border-slate-700 bg-slate-900/70 p-8 transition duration-200 hover:-translate-y-1 hover:border-indigo-400 hover:bg-slate-900"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-indigo-300">
                  {item.label}
                </p>
                <h3 className="font-display mt-3 text-2xl font-semibold text-slate-100">{item.title}</h3>
                <p className="mt-4 text-base leading-7 text-slate-300">{item.description}</p>
                <ul className="mt-6 space-y-2 text-sm text-slate-200">
                  {item.points.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-7 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300 transition group-hover:text-cyan-200">
                  Explore use case
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="border-y border-slate-800 bg-slate-950/60">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 lg:grid-cols-3 lg:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Step 01</p>
              <h3 className="font-display mt-3 text-xl font-semibold text-white">Model metrics once</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Define analytics in TypeScript with explicit inputs, outputs, and auth expectations.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Step 02</p>
              <h3 className="font-display mt-3 text-xl font-semibold text-white">Integrate into your backend</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Mount generated routes where needed or call queries in-process from existing handlers.
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Step 03</p>
              <h3 className="font-display mt-3 text-xl font-semibold text-white">Expand usage safely</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Reuse the same definitions across dashboards, services, and internal tools without drift.
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-16 lg:px-6">
          <div className="border border-indigo-500/40 bg-[linear-gradient(140deg,rgba(30,41,59,0.9),rgba(15,23,42,0.92))] p-8 md:flex md:items-center md:justify-between md:gap-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-indigo-300">
                Next step
              </p>
              <h3 className="font-display mt-3 text-2xl font-semibold text-white">
                Start with the use case closest to your current architecture
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                Both paths share the same core model: define once, run anywhere, govern centrally.
              </p>
            </div>
            <div className="mt-6 md:mt-0">
              <Link
                href="/docs/quick-start"
                className="inline-flex items-center bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Open quick start
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
