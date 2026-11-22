import type { FaqItem } from '@/lib/structured-data';

// The typed shape behind the hypequery-vs-<vendor> pages for embedded analytics
// vendors (/compare/hypequery-vs-querypanel, /compare/hypequery-vs-explo). Every
// page renders the same sections in the same order through
// src/components/comparison-page.tsx, and every claim about the other vendor is
// listed in `sources` with the URL it was checked against and the date.
//
// Copy fields accept two kinds of inline markup: `code` spans and
// [link text](/path) links. Nothing else is parsed.

/** One verified claim about the other vendor. Unverifiable claims stay off the page. */
export type ComparisonSource = {
  claim: string;
  url: string;
  /** ISO date (YYYY-MM-DD) the URL was read. */
  checkedAt: string;
};

/** The ten rows every comparison table has, in this order. */
export const COMPARISON_ROWS = [
  ['deployment', 'Deployment model'],
  ['license', 'Open source and licence'],
  ['dataSources', 'Data sources'],
  ['clickhouse', 'ClickHouse support'],
  ['tenantIsolation', 'Tenant isolation'],
  ['semanticLayer', 'Metrics and semantic layer'],
  ['api', 'API access'],
  ['agents', 'AI agents and MCP'],
  ['embedding', 'Front-end embedding'],
  ['pricing', 'Pricing model'],
] as const;

export type ComparisonRowKey = (typeof COMPARISON_ROWS)[number][0];

export type ComparisonCell = { hypequery: string; competitor: string };

export type ComparisonCode = {
  code: string;
  filename: string;
  language?: string;
  /** One line under the code window: what the sample is and where it came from. */
  caption: string;
};

export type ComparisonPage = {
  slug: `hypequery-vs-${string}`;
  path: `/compare/hypequery-vs-${string}`;
  /** The other product's name as it should appear in headings. */
  competitor: string;
  primaryKeyword: string;
  /** The rendered <title>, 60 characters or fewer. */
  title: string;
  /** Meta description, 155 characters or fewer. */
  description: string;
  h1: string;
  published: string;
  /** ISO date every competitor fact on the page was last checked. */
  verifiedOn: string;
  /** Exactly three sentences: what the other product is, who it suits, how hypequery differs. */
  tldr: readonly [string, string, string];
  /** An optional status note above the table, for example an acquisition or sunset. */
  notice?: { title: string; body: string };
  rows: Record<ComparisonRowKey, ComparisonCell>;
  competitorBetterWhen: string[];
  chooseHypequeryWhen: string[];
  /** Longer sections between the decision lists and the code. Paragraph strings, inline markup allowed. */
  sections: Array<{ id: string; eyebrow: string; title: string; paragraphs: string[] }>;
  code: { hypequery: ComparisonCode; competitor?: ComparisonCode };
  faq: FaqItem[];
  sources: ComparisonSource[];
  /** The two lines shown on this page's card on /compare. */
  hubCard: { bestFitFor: string; chooseHypequeryWhen: string };
};
