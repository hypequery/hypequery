import { FeatureCard, FeatureCardCopy } from './FeatureCard';

export function ProductAnalyticsCard() {
  return (
    <FeatureCard number="08" animationDelay={490} className="sm:col-span-2 lg:col-span-4 lg:p-6">
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center">
        <div>
          <div className="max-w-[440px]"><FeatureCardCopy large title="Built for product analytics" description="Give customers consistent answers inside your product. Reuse measures, time periods, and tenant rules across every view." /></div>
          <div className="mt-6 flex flex-wrap gap-2" aria-label="Product analytics capabilities">
            {[
              'Shared metrics',
              'Table joins',
              'SQL-backed measures',
              'Derived measures',
              'Filtered measures',
              'Period comparisons',
              'Time grains',
              'Reusable segments',
              'Tenant rules',
            ].map((feature) => <span key={feature} className="rounded-full border border-border bg-bg-card/70 px-3 py-1.5 text-xs text-text-muted">{feature}</span>)}
          </div>
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-bg-card/80" role="img" aria-label="Example product analytics dashboard with revenue and orders charts">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /><span className="text-xs font-semibold text-text">Overview</span></div>
            <span className="rounded-md border border-border bg-bg-alt/50 px-2 py-1 font-mono text-[10px] text-text-muted">Last 30 days</span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-lg border border-border bg-bg-alt/50 p-3"><span className="text-[11px] text-text-muted">Revenue</span><div className="mt-1 flex items-end gap-2"><strong className="text-xl font-semibold tracking-tight text-text">$128k</strong><span className="mb-1 text-[10px] text-accent">↑ 18%</span></div></div>
            <div className="rounded-lg border border-border bg-bg-alt/50 p-3"><span className="text-[11px] text-text-muted">Orders</span><div className="mt-1 flex items-end gap-2"><strong className="text-xl font-semibold tracking-tight text-text">2,846</strong><span className="mb-1 text-[10px] text-accent">↑ 12%</span></div></div>
            <div className="col-span-2 rounded-lg border border-border bg-bg-alt/50 p-3">
              <div className="flex items-center justify-between"><span className="text-[11px] text-text-muted">Revenue over time</span><span className="h-2 w-2 rounded-full bg-accent" /></div>
              <svg className="mt-3 h-24 w-full" viewBox="0 0 480 96" preserveAspectRatio="none" fill="none" aria-hidden="true">
                <path d="M0 76H480M0 48H480M0 20H480" stroke="var(--border)" strokeDasharray="3 5" />
                <path d="M0 75C25 68 42 70 63 61S106 71 128 55S168 58 190 47S230 50 253 40S296 49 318 31S356 38 379 23S423 29 445 15S467 18 480 8" stroke="var(--accent-hi)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </FeatureCard>
  );
}
