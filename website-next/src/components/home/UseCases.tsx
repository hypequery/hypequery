import { Plug, Building2, Bot, LayoutDashboard, ScrollText, Gauge } from 'lucide-react';

const USE_CASES = [
  {
    icon: Plug,
    title: 'Internal product APIs',
    desc: 'Typed analytics endpoints without a BI tool in the loop.',
  },
  {
    icon: Building2,
    title: 'Multi-tenant SaaS',
    desc: 'Tenant isolation enforced at the query layer, not by convention.',
  },
  {
    icon: Bot,
    title: 'Agent-ready data',
    desc: 'Give your AI agents governed metrics, not database credentials.',
  },
  {
    icon: LayoutDashboard,
    title: 'Customer-facing dashboards',
    desc: 'Typed React hooks straight from ClickHouse. No embedded BI iframe.',
  },
  {
    icon: ScrollText,
    title: 'Logs & event telemetry',
    desc: 'Query billions of rows of nested event data with autocomplete, not hand-rolled SQL strings.',
  },
  {
    icon: Gauge,
    title: 'AI usage analytics',
    desc: 'Track tokens, cost, and latency per tenant — with metrics your agents can query about themselves.',
  },
];

export function UseCases() {
  return (
    <section className="mx-auto max-w-[1280px] px-8 pt-[112px] pb-6">
      <div className="mb-12 text-center">
        <p className="font-mono text-eyebrow text-accent mb-3.5">Use cases</p>
        <h2 className="text-h2 text-text mx-auto max-w-[680px] text-balance">
          Built for the products you&apos;re already shipping.
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {USE_CASES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="rounded-lg border border-border bg-bg-card p-6">
            <div className="grid h-[38px] w-[38px] place-items-center rounded-lg bg-accent-soft text-accent">
              <Icon className="h-[19px] w-[19px]" strokeWidth={2} />
            </div>
            <h3 className="mt-4 text-[16px] font-bold leading-tight text-text">{title}</h3>
            <p className="mt-2 text-body-sm text-text-muted text-pretty">{desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
