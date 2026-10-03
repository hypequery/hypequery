import { InstallCommand } from './InstallCommand';
import { FeatureCard, FeatureCardCopy } from './FeatureCard';

export function CloudFeatureCards() {
  return (
    <>
      <FeatureCard number="05" animationDelay={280} className="min-h-[220px] sm:col-span-2">
        <div className="mt-7"><FeatureCardCopy title="Deploy to cloud in one command" description="Publish your datasets once. Cloud serves them as APIs and MCP tools." /></div>
        <div className="mt-auto pt-5" aria-label="One deployment creates hosted REST and MCP endpoints">
          <InstallCommand command="hypequery deploy analytics/cloud.ts" variant="card" className="w-full justify-between text-left" />
          <div className="mt-2 grid grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border border-border bg-bg-card/70">
            <div className="min-w-0 px-3 py-2">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-text-muted">Hosted API</span>
              <span className="mt-1 block text-xs text-text"><span className="mr-1.5 text-accent">→</span>/execute</span>
            </div>
            <div className="min-w-0 px-3 py-2">
              <span className="block text-[10px] font-medium uppercase tracking-wider text-text-muted">Hosted MCP</span>
              <span className="mt-1 block text-xs text-text"><span className="mr-1.5 text-accent">→</span>/mcp</span>
            </div>
          </div>
        </div>
      </FeatureCard>
      <FeatureCard number="06" animationDelay={350} className="min-h-[220px]">
        <div className="mt-7"><FeatureCardCopy title="Built for ClickHouse" description="Native time grains, approximate distincts, quantiles, and latest-value measures." /></div>
        <div className="mt-auto pt-5">
          <div className="flex flex-wrap gap-1.5 text-[10px] text-text-muted">
            {['toStartOf*', 'uniq', 'quantile', 'argMax / argMin'].map((feature) => (
              <span key={feature} className="rounded-md border border-border bg-bg-card/70 px-2 py-1 font-mono">{feature}</span>
            ))}
          </div>
        </div>
      </FeatureCard>
      <FeatureCard number="07" animationDelay={420} className="min-h-[220px]">
        <div className="mt-7"><FeatureCardCopy title="Versioned releases" description="Roll back to an earlier release when your model changes." /></div>
        <div className="mt-auto pt-5">
          <div className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-bg-card/70 px-3 text-xs text-text-muted"><span>v1</span><span className="text-accent">→</span><span>v2</span><span className="text-accent">↶</span></div>
        </div>
      </FeatureCard>
    </>
  );
}
