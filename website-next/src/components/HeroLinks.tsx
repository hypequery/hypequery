import Link from 'next/link';
import Image from 'next/image';

const heroLinks = [
  { label: 'Docs', href: '/docs' },
  { label: 'Solutions', href: '#solutions' },
  { label: 'Blog', href: '/blog' },
  { label: 'GitHub', href: 'https://github.com/hypequery/hypequery', external: true },
];

export default function HeroLinks() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm font-semibold uppercase tracking-[0.2em] text-gray-300/80">
      <Link href="/" className="mr-2 flex items-center">
        <Image
          src="/logo_sm.svg"
          alt="hypequery"
          width={28}
          height={28}
          className="h-7 w-7"
          priority
        />
      </Link>
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
