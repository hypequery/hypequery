import { absoluteUrl } from '@/lib/site';

export type BreadcrumbItem = {
  label: string;
  /** Omit for the current page. */
  href?: string;
};

/** schema.org BreadcrumbList for a trail of pages. The last item is the current page. */
export function breadcrumbJsonLd(items: readonly BreadcrumbItem[], currentPath: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: absoluteUrl(item.href ?? currentPath).toString(),
    })),
  };
}

export type FaqItem = { question: string; answer: string };

/** schema.org FAQPage for a list of plain-text answers. */
export function faqJsonLd(items: readonly FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

/** schema.org ItemList for a ranked or grouped list of things, in the order they appear on the page. */
export function itemListJsonLd(name: string, items: ReadonlyArray<{ name: string; url?: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      ...(item.url ? { url: item.url } : {}),
    })),
  };
}

/** schema.org TechArticle for an editorial page. Dates are ISO (YYYY-MM-DD). */
export function techArticleJsonLd({
  path,
  headline,
  description,
  datePublished,
  dateModified,
}: {
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline,
    description,
    url: absoluteUrl(path).toString(),
    datePublished,
    dateModified,
    author: { '@type': 'Organization', name: 'hypequery' },
    publisher: { '@type': 'Organization', name: 'hypequery', url: absoluteUrl('/').toString() },
  };
}
