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
