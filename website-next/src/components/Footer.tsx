import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';

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
      { label: 'Quick Start', href: '/docs/quick-start' },
      { label: 'Query builder', href: '/clickhouse-query-builder' },
      { label: 'Semantic Layer', href: '/clickhouse-semantic-layer' },
      { label: 'Schema Types', href: '/clickhouse-schema' },
      { label: 'Compare', href: '/compare' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'ClickHouse API', href: '/clickhouse-api' },
      { label: 'ClickHouse Next.js', href: '/clickhouse-nextjs' },
      { label: 'ClickHouse React', href: '/clickhouse-react' },
      { label: 'ClickHouse Node.js', href: '/clickhouse-nodejs' },
      { label: 'ClickHouse MCP', href: '/clickhouse-mcp' },
      { label: 'GitHub', href: 'https://github.com/hypequery/hypequery', external: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Blog', href: '/blog' },
      { label: 'Use Cases', href: '/use-cases' },
      { label: 'Internal Product APIs', href: '/use-cases/internal-product-apis' },
      { label: 'Multi-Tenant SaaS', href: '/use-cases/multi-tenant-saas' },
      { label: 'Contact', href: '/contact-us' },
      { label: 'Book a call', href: 'https://cal.com/luke-reilly-jdi9su/hypequery-chat', external: true, track: 'book_call' },
    ],
  },
  {
    title: 'Social',
    links: [
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
        <div className="max-w-[240px]" style={{ width: '240px', flexShrink: 0 }}>
          <div className="font-mono text-[15px] font-bold text-text tracking-tight">&gt; hypequery</div>
          <p className="mt-2 text-[13px] leading-snug text-text-muted">
            The TypeScript analytics layer for ClickHouse.
          </p>
        </div>

        {footerColumns.map((column) => (
          <div key={column.title} className="min-w-0" style={{ width: '160px', flexShrink: 0 }}>
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
                    data-umami-event-target={link.track}
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
