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

/**
 * Cards whose title is a question, as FAQ items: the card is the visible
 * question and answer, so it can back FAQPage data like an FAQ section does.
 * Inline-code backticks are dropped from the answer text.
 */
export function questionCardsAsFaq(cards: ReadonlyArray<{ title: string; copy: string }>): FaqItem[] {
  return cards
    .filter((card) => card.title.trim().endsWith('?'))
    .map((card) => ({ question: card.title.trim(), answer: card.copy.replace(/`/g, '') }));
}

/** FAQ items without repeated questions, keeping the first of each. */
export function uniqueFaq(items: readonly FaqItem[]): FaqItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.question.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
