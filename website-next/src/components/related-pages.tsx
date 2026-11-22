import Link from 'next/link';
import { HubLinkGrid, type HubLink } from '@/components/hub-page';
import { marketing } from '@/components/ui/marketing';
import { productDocsLinks } from '@/data/related-pages';

/**
 * The related-pages block for /compare/* and /semantic-layer/* pages: sibling
 * pages and the section hub as cards, then the docs as a compact list.
 */
export function RelatedPages({
  eyebrow = 'Related',
  title,
  pages,
  band = false,
}: {
  eyebrow?: string;
  title: string;
  pages: HubLink[];
  band?: boolean;
}) {
  return (
    <section className={band ? marketing.band : undefined} aria-labelledby="related-pages-title">
      <div className={`${marketing.container} py-14 sm:py-20`}>
        <p className={marketing.eyebrow}>{eyebrow}</p>
        <h2 id="related-pages-title" className={`mt-3 max-w-[820px] text-balance ${marketing.sectionTitle}`}>
          {title}
        </h2>
        <div className="mt-10">
          <HubLinkGrid links={pages} />
        </div>
        <h3 className="mt-12 text-[17px] font-medium tracking-tight text-text">From comparison to code</h3>
        <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {productDocsLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="group block">
                <span className="text-sm font-medium text-text group-hover:text-accent">{link.title}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-text-muted">{link.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
