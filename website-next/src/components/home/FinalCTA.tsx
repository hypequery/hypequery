import Link from 'next/link';
import { marketing } from '../ui/marketing';
import { DeployWaitlist } from './DeployWaitlist';
import { SetupCommand } from './SetupCommand';

// The section hubs for readers still comparing options. The homepage is the
// strongest page on the site, so these links also carry weight to the hubs.
const GUIDE_LINKS = [
  { href: '/compare', label: 'Compare hypequery' },
  { href: '/semantic-layer', label: 'What is a semantic layer' },
  { href: '/embedded-analytics', label: 'Embedded analytics' },
] as const;

export function FinalCTA() {
  return (
    <section className={`mx-auto max-w-[1280px] px-8 text-center ${marketing.homeSectionSpacing}`}>
      <h2 className="home-section-title text-text max-w-[820px] mx-auto text-balance">
        Ship your analytics layer today
      </h2>
      <p className="mt-3.5 text-body text-text-muted max-w-[560px] mx-auto text-pretty">
        Start open source in your own backend. hypequery cloud, the hosted option, is in early access.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/docs"
          className={marketing.primaryButton}
        >
          Get started <span aria-hidden="true">→</span>
        </Link>
        <DeployWaitlist location="final" className={marketing.secondaryButton} />
      </div>
      <SetupCommand className="mt-4 justify-center" />
      <nav aria-label="Guides for evaluating hypequery" className="mt-8 text-sm text-text-muted">
        <span>Still evaluating? </span>
        {GUIDE_LINKS.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? <span aria-hidden="true"> · </span> : null}
            <Link
              href={link.href}
              className="underline decoration-border-strong underline-offset-4 transition hover:text-accent hover:decoration-accent"
            >
              {link.label}
            </Link>
          </span>
        ))}
      </nav>
      {/* The same space below the last section as between sections. A spacer rather than
          responsive bottom padding: this site's CSS emits some base pb-* utilities after
          their sm: variants, so sm:pb-* can lose. */}
      <div aria-hidden="true" className={marketing.homeSectionSpacing} />
    </section>
  );
}
