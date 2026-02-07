import Link from 'next/link';

const heroLinks = [
  { label: 'Docs', href: '/docs' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Blog', href: '/blog' },
  { label: 'GitHub', href: 'https://github.com/hypequery/hypequery', external: true },
];

export default function HeroLinks() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm font-semibold uppercase tracking-[0.2em] text-gray-300/80">
      {heroLinks.map((item) =>
        item.external ? (
          <a
            key={item.label}
            href={item.href}
            className="hero-link"
            target="_blank"
            rel="noreferrer"
          >
            {item.label}
          </a>
        ) : (
          <Link key={item.label} href={item.href} className="hero-link">
            {item.label}
          </Link>
        ),
      )}
    </div>
  );
}
