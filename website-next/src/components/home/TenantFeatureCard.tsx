import { FeatureCard, FeatureCardCopy } from './FeatureCard';

export function TenantFeatureCard() {
  return (
    <FeatureCard number="04" animationDelay={210}>
      <div className="mt-7"><FeatureCardCopy title="Multi-tenancy ready" description="Keep every customer's analytics scoped to their data." /></div>
      <div className="mt-auto grid gap-2 pt-4" role="img" aria-label="Two customers, each with a separate analytics view">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-card/70 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true" />
          <span className="text-xs font-medium text-text">Customer A</span>
          <span className="ml-auto h-1.5 w-12 rounded-full bg-accent/30" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-bg-card/70 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#5ca9a0]" aria-hidden="true" />
          <span className="text-xs font-medium text-text">Customer B</span>
          <span className="ml-auto h-1.5 w-8 rounded-full bg-[#5ca9a0]/40" aria-hidden="true" />
        </div>
      </div>
    </FeatureCard>
  );
}
