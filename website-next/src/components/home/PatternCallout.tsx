import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export function PatternCallout() {
  return (
    <section aria-label="Why companies build an analytics layer" className="mx-auto max-w-[1280px] px-5 sm:px-8">
      <Link
        href="/blog/seven-companies-one-pattern-why-every-scaled-clickhouse-deployment-looks-the-same"
        className="group flex flex-col items-center justify-center gap-x-3 gap-y-1 border-y border-border py-5 text-center text-sm text-text-muted transition hover:text-text sm:flex-row sm:text-base"
      >
        <span>Uber, Cloudflare, and Instacart each built an analytics layer on ClickHouse.</span>
        <span className="inline-flex items-center gap-1 font-medium text-text transition group-hover:text-accent">
          Read why
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </Link>
    </section>
  );
}
