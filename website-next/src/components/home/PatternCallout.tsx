import Link from 'next/link';

/** The problem, stated once, with the companies that built this backend themselves as proof. */
export function PatternCallout() {
  return (
    <section aria-labelledby="pattern-callout-title" className="mx-auto max-w-[1280px] px-5 pt-6 sm:px-8">
      <div className="grid items-center gap-x-12 gap-y-4 border-y border-border max-md:py-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:py-7">
        <h2 id="pattern-callout-title" className="font-normal leading-snug tracking-[-0.02em] text-text max-md:text-lg md:text-xl">
          Every team that scales ClickHouse ends up building this backend.
        </h2>
        <div>
          <p className="text-sm leading-6 text-text-muted sm:text-base">
            <Link
              href="/blog/seven-companies-one-pattern-why-every-scaled-clickhouse-deployment-looks-the-same"
              className="font-medium text-text underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent"
            >
              Read why
            </Link>{' '}
            Uber, Cloudflare, and Instacart each built their own. hypequery is that backend as a library you own.
          </p>
        </div>
      </div>
    </section>
  );
}
