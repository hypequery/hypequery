import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import { HypequeryMascotIcon } from '@/components/HypequeryMascotIcon';

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
  track?: string;
};

const footerColumns: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: 'Product',
    links: [
      { label: 'Home', href: '/' },
      { label: 'Docs', href: '/docs' },
      { label: 'Python SDK', href: '/docs/python' },
      { label: 'Query builder', href: '/clickhouse-query-builder' },
      { label: 'Semantic Layer', href: '/clickhouse-semantic-layer' },
      { label: 'Schema Types', href: '/clickhouse-schema' },
      { label: 'Compare', href: '/compare' },
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Internal Product APIs', href: '/use-cases/internal-product-apis' },
      { label: 'Multi-Tenant SaaS', href: '/use-cases/multi-tenant-saas' },
      { label: 'Changelog', href: '/changelog' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'ClickHouse API', href: '/clickhouse-api' },
      { label: 'ClickHouse Next.js', href: '/clickhouse-nextjs' },
      { label: 'ClickHouse React', href: '/clickhouse-react' },
      { label: 'ClickHouse Node.js', href: '/clickhouse-nodejs' },
      { label: 'ClickHouse Python', href: '/clickhouse-python' },
      { label: 'ClickHouse FastAPI', href: '/clickhouse-fastapi' },
      { label: 'ClickHouse Django', href: '/clickhouse-django' },
      { label: 'ClickHouse Flask', href: '/clickhouse-flask' },
      { label: 'ClickHouse MCP', href: '/clickhouse-mcp' },
    ],
  },
  {
    // Hub pages that link on to the function reference, guides and comparisons,
    // so every page passes crawlers a path to them.
    title: 'Learn',
    links: [
      // The semantic layer hub is already linked from the Product column.
      { label: 'ClickHouse for developers', href: '/clickhouse' },
      { label: 'Embedded analytics', href: '/embedded-analytics' },
      { label: 'What is a semantic layer', href: '/semantic-layer' },
      { label: 'ClickHouse functions', href: '/clickhouse/functions' },
      { label: 'Materialized views guide', href: '/blog/a-guide-to-materialized-views-in-clickhouse' },
      { label: 'MooseStack migration guide', href: '/blog/migrating-moosestack-to-hypequery' },
      { label: 'ClickHouse ORM', href: '/clickhouse-orm' },
      { label: 'ClickHouse TypeScript', href: '/clickhouse-typescript' },
      { label: 'Real-time analytics', href: '/clickhouse-real-time-analytics' },
      { label: 'SaaS analytics', href: '/clickhouse-saas-analytics' },
      { label: 'Product analytics', href: '/clickhouse-product-analytics' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'Newsletter', href: '/blog#newsletter' },
      { label: 'RSS', href: '/blog/rss.xml' },
      { label: 'Contact', href: '/contact-us' },
      { label: 'Book a call', href: 'https://cal.com/luke-reilly-jdi9su/hypequery-chat', external: true, track: 'book_call' },
      { label: 'GitHub', href: 'https://github.com/hypequery/hypequery', external: true },
      { label: 'X / Twitter', href: 'https://x.com/hypequery', external: true },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/company/110435355/', external: true },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border px-8 pt-[60px] pb-9 bg-bg">
      <div className="mx-auto max-w-[1280px] footer-grid">
        {/* Brand and columns shrink rather than overflow when the row is narrower than their full widths. */}
        <div className="min-w-0 max-w-[240px]" style={{ flex: '0 1 240px' }}>
          <div className="inline-flex items-center gap-2 font-mono text-[15px] font-bold text-text tracking-tight">
            <HypequeryMascotIcon className="h-6 w-auto shrink-0" />
            <span>hypequery</span>
          </div>
          <p className="mt-2 text-[13px] leading-snug text-text-muted">
            Embedded analytics on ClickHouse.
          </p>
        </div>

        {footerColumns.map((column) => (
          <div key={column.title} className="min-w-0" style={{ flex: '0 1 160px' }}>
            <div className="mb-3.5 font-mono text-[11.5px] font-bold uppercase tracking-[0.12em] text-text-dim">
              {column.title}
            </div>
            <div className="flex flex-col items-start gap-2">
              {column.links.map((link) =>
                link.external ? (
                  <a
                    key={link.label}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    data-umami-event={link.track ? 'cta_click' : undefined}
                    data-umami-event-target={link.track ? link.track : undefined}
                    data-umami-event-location={link.track ? 'footer' : undefined}
                    className="block text-[13.5px] text-text-muted transition hover:text-text"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.label}
                    href={link.href}
                    className="block text-[13.5px] text-text-muted transition hover:text-text"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-12 max-w-[1280px] footer-bottom border-t border-border pt-6 text-xs text-text-dim">
        <span>© {year} hypequery. All rights reserved.</span>
        <ThemeToggle />
      </div>
    </footer>
  );
}
