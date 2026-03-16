import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
  theme?: 'light' | 'dark';
};

export default function Breadcrumbs({
  items,
  className = '',
  theme = 'light',
}: BreadcrumbsProps) {
  const isDark = theme === 'dark';
  const linkClassName = isDark
    ? 'text-slate-400 hover:text-slate-200'
    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100';
  const currentClassName = isDark
    ? 'text-slate-200'
    : 'text-gray-900 dark:text-gray-100';
  const separatorClassName = isDark
    ? 'text-slate-600'
    : 'text-gray-400 dark:text-gray-600';

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-2">
              {item.href && !isLast ? (
                <Link href={item.href} className={`transition-colors ${linkClassName}`}>
                  {item.label}
                </Link>
              ) : (
                <span className={currentClassName} aria-current={isLast ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!isLast ? <ChevronRight className={`h-4 w-4 ${separatorClassName}`} /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
