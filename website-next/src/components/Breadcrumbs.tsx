import Link from 'next/link';
import { breadcrumbJsonLd, type BreadcrumbItem } from '@/lib/structured-data';

/** A visible breadcrumb trail plus its BreadcrumbList JSON-LD. The last item is the current page. */
export function Breadcrumbs({
  items,
  currentPath,
  className = 'text-text-dim',
}: {
  items: readonly BreadcrumbItem[];
  currentPath: string;
  className?: string;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(items, currentPath)) }}
      />
      <nav aria-label="Breadcrumb" className={`text-[13px] ${className}`}>
        <ol className="flex flex-wrap items-center gap-1.5">
          {items.map((item, index) => {
            const isLast = index === items.length - 1;
            return (
              <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
                {item.href && !isLast ? (
                  <Link href={item.href} className="transition hover:text-accent">
                    {item.label}
                  </Link>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'font-medium' : undefined}>
                    {item.label}
                  </span>
                )}
                {!isLast && <span aria-hidden="true">›</span>}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
