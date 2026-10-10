import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

/** The problem, stated once, with the companies that built this layer themselves as proof. */
export function PatternCallout() {
  return (
    <section aria-labelledby="pattern-callout-title" className="mx-auto max-w-[1280px] px-5 pt-6 sm:px-8">
      <div className="grid items-center gap-x-12 gap-y-4 border-y border-border py-8 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:py-10">
        <h2 id="pattern-callout-title" className="text-[1.6rem] font-normal leading-tight tracking-[-0.03em] text-text md:text-[2rem]">
          Give your agents numbers you can trust.
        </h2>
        <div>
          <p className="text-sm leading-6 text-text-muted sm:text-base">
            AI writing raw SQL gets your numbers wrong. Uber, Cloudflare, and Instacart each built an analytics layer on
            ClickHouse, so every team and every tool answers from the same governed definitions.
          </p>
          <Link
            href="/blog/seven-companies-one-pattern-why-every-scaled-clickhouse-deployment-looks-the-same"
            className="group mt-3 inline-flex items-center gap-1 text-sm font-medium text-text transition hover:text-accent"
          >
            Read why
            <ArrowUpRight className="h-4 w-4 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
