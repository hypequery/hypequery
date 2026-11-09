export type FaqItem = {
  question: string;
  answer: string;
};

/**
 * schema.org FAQPage JSON-LD for a list of visible FAQ items. Pass the same
 * array the page renders so the structured data matches the visible text.
 */
export function faqPageSchema(items: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  };
}
