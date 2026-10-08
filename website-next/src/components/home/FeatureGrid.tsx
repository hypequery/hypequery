import Link from 'next/link';
import { ArrowRight, Check, Clock3, GitPullRequest, KeyRound, LockKeyhole, Network, ShieldCheck, Tags, TrendingUp, Zap } from 'lucide-react';
import { SiPython, SiTypescript } from 'react-icons/si';
import { FeatureCard } from './FeatureCard';

export function FeatureGrid() {
  return (
    <section aria-labelledby="feature-grid-title" className="mx-auto max-w-[1280px] px-5 pb-12 pt-14 sm:px-8 sm:pt-20">
      <div className="mb-8 max-w-[620px]">
        <h2 id="feature-grid-title" className="home-section-title text-text">The hard parts, handled</h2>
        <p className="mt-4 text-sm leading-6 text-text-muted sm:text-base">Tenant isolation, joins, access control, and caching come with the model, not as afterthoughts.</p>
      </div>
      <div className="product-feature-grid grid gap-4">
        <FeatureCard number="01" animationDelay={0} topRight={<LockKeyhole className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Keep customers isolated</h3>
          <p>Scope every query from your auth. Missing tenant context? The request is rejected.</p>
          <div className="feature-proof" role="img" aria-label="An authenticated tenant scopes each query; missing tenant context is rejected">
            <div className="flex items-center gap-2 text-xs"><KeyRound className="h-3.5 w-3.5 text-accent" aria-hidden="true" /><span>Authenticated tenant</span><code className="ml-auto text-text-muted">acme</code></div>
            <div className="mt-3 border-t border-border pt-3 font-mono text-[11px] text-text-muted">WHERE tenant_id = <span className="text-accent">&apos;acme&apos;</span></div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted"><ShieldCheck className="h-3.5 w-3.5 text-accent" aria-hidden="true" />No tenant context? Query rejected.</div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/multi-tenancy">Explore tenant isolation <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>

        <FeatureCard number="02" animationDelay={70} topRight={<TrendingUp className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Encode your business logic</h3>
          <p>Ratios, period comparisons, and named segments like enterprise accounts. Bucket by day, week, or month in any timezone.</p>
          <div className="feature-proof" role="img" aria-label="Average order value and revenue growth for the enterprise accounts segment, grouped by month">
            <div className="flex justify-between gap-3 text-xs"><span>Average order value</span><span className="font-medium">$80</span></div>
            <div className="mt-1 font-mono text-[10px] text-text-muted">revenue / orders</div>
            <div className="mt-3 flex justify-between gap-3 border-t border-border pt-3 text-xs"><span>Revenue vs. previous month</span><span className="font-medium text-accent">+23.1%</span></div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-3 text-[11px]"><span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-accent-soft px-2.5 py-0.5 text-accent"><Tags className="h-3 w-3" aria-hidden="true" />Enterprise</span><span className="ml-auto rounded-md border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-accent">Month</span><span className="flex items-center gap-1 text-text-muted"><Clock3 className="h-3 w-3" aria-hidden="true" />UTC</span></div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/measures">Explore calculations <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>

        <FeatureCard number="03" animationDelay={140} topRight={<Network className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Connect your business data</h3>
          <p>Break down revenue by customer attributes. Declare relationships; hypequery handles the joins.</p>
          <div className="feature-proof" role="img" aria-label="Orders connect to customers to group revenue by customer country">
            <div className="flex items-center gap-3 font-mono text-[11px]"><span className="rounded-md border border-border px-3 py-2">orders</span><span className="h-px flex-1 bg-border-strong" aria-hidden="true" /><span className="rounded-md border border-border px-3 py-2">customers</span></div>
            <div className="mt-4 flex justify-between gap-3 text-[11px] text-text-muted"><span>Measure</span><code className="text-text">revenue</code></div>
            <div className="mt-2 flex justify-between gap-3 text-[11px] text-text-muted"><span>Group by</span><code className="text-text">customer.country</code></div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/relationships">Explore relationships <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>

        <FeatureCard number="04" animationDelay={210} topRight={<ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Control what&apos;s queryable</h3>
          <p>Publish chosen fields and filters. Generated tools validate requests against your model.</p>
          <div className="feature-proof" role="img" aria-label="Declared revenue measure is accepted; an undeclared field is rejected">
            <div className="text-[10px] font-medium uppercase tracking-wider text-text-muted">Published query contract</div>
            <div className="mt-3 flex items-center gap-2 font-mono text-[11px]"><Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /><span>revenue</span><span className="ml-auto font-sans text-text-muted">Declared measure</span></div>
            <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 font-mono text-[11px]"><LockKeyhole className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" /><span>internal_margin</span><span className="ml-auto font-sans text-text-muted">Not exposed</span></div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/tool-generation">Explore query controls <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>

        <FeatureCard number="05" animationDelay={280} topRight={<GitPullRequest className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Review analytics in pull requests</h3>
          <p>Define analytics in TypeScript or Python. Review changes alongside your application code.</p>
          <div className="feature-proof" role="img" aria-label="Illustrative code review changing the definition of net revenue">
            <div className="flex items-center gap-2 text-[11px] text-text-muted"><GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" /><span>Refine net revenue</span><div className="ml-auto flex gap-2" aria-hidden="true"><SiTypescript className="h-3.5 w-3.5 text-[#3178c6]" /><SiPython className="h-3.5 w-3.5 text-[#3776ab]" /></div></div>
            <div className="mt-3 border-t border-border pt-3 font-mono text-[11px] leading-6"><div className="text-text-muted"><span className="mr-3">−</span>revenue</div><div className="rounded bg-accent-soft text-accent"><span className="mr-3">+</span>revenue − refunds</div></div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/defining-datasets">Explore model definitions <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>

        <FeatureCard number="06" animationDelay={350} topRight={<Zap className="h-5 w-5 text-accent" aria-hidden="true" />}>
          <h3>Reuse answers efficiently</h3>
          <p>Cache repeated queries with tenant-aware keys. Set freshness windows and refresh results in the background.</p>
          <div className="feature-proof" role="img" aria-label="A repeated query can use a cached result for the same tenant, with a 60 second freshness window">
            <div className="flex items-center justify-between gap-2 text-xs"><span>Repeated query</span><span className="flex items-center gap-1 text-[11px] text-accent"><Zap className="h-3 w-3" aria-hidden="true" />Cache hit</span></div>
            <div className="mt-3 flex justify-between border-t border-border pt-3 text-[11px] text-text-muted"><span>Fresh for</span><span className="text-text">60 seconds</span></div>
            <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted"><LockKeyhole className="h-3 w-3" aria-hidden="true" />Separate keys for every tenant</div>
          </div>
          <Link className="feature-detail-link" href="/docs/datasets/caching">Explore caching <ArrowRight aria-hidden="true" /></Link>
        </FeatureCard>
      </div>
    </section>
  );
}
