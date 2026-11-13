// The embedded analytics comparison cluster. These are static routes (not
// compare-pages.ts entries) because their layouts differ from the two-column
// hypequery-vs-X template. The /compare hub, sitemap and llms.txt read this list.

export type EmbeddedAnalyticsComparePage = {
  href: string;
  title: string;
  description: string;
};

export const embeddedAnalyticsComparePages: EmbeddedAnalyticsComparePage[] = [
  {
    href: '/compare/embedded-analytics-platforms',
    title: 'Best embedded analytics platforms',
    description:
      'Twelve platforms grouped by approach: code-first and headless, embedded BI, and BI tools with embedding. Embedding method, multi-tenancy, pricing model and who each suits.',
  },
  {
    href: '/compare/embedded-analytics-pricing',
    title: 'Embedded analytics pricing compared',
    description:
      'Pricing models, lowest published prices and what is gated behind higher tiers, with one 1,000-viewer scenario priced across every vendor that publishes enough to do it.',
  },
  {
    href: '/compare/luzmo-alternatives',
    title: 'Luzmo alternatives',
    description:
      'Alternatives grouped by why teams leave Luzmo: owning the front end, giving customers a full BI tool, or cost at scale.',
  },
  {
    href: '/compare/hypequery-vs-embeddable',
    title: 'hypequery vs Embeddable',
    description:
      'Where the data model lives, how tenant isolation is enforced, who owns the UI, and what each serves besides dashboards.',
  },
  {
    href: '/cube-js-alternative',
    title: 'Cube alternatives',
    description:
      'Semantic layers compared for embedded analytics and AI agents: hypequery, the dbt Semantic Layer, AtScale, GoodData and Boring Semantic Layer.',
  },
];
