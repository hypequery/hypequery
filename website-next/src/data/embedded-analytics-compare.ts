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
    href: '/compare/embedded-analytics-typescript',
    title: "Embedded analytics buyer's guide for TypeScript teams",
    description:
      'Compare architectures by metric governance, tenant isolation, type safety, change control and UI ownership, with a proof-based evaluation checklist.',
  },
  {
    href: '/compare/embedded-analytics-platforms',
    title: 'Best embedded analytics platforms',
    description:
      'Fifteen platforms grouped by approach (code-first and headless, embedded BI, and BI tools with embedding), with embedding method, multi-tenancy, pricing model and who each suits.',
  },
  {
    href: '/compare/build-vs-buy-embedded-analytics',
    title: 'Build vs buy embedded analytics',
    description:
      'What each part of embedded analytics costs to build, when buying a platform wins, and the middle path of an open-source data layer with your own front end.',
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
      'Alternatives grouped by why teams leave Luzmo, whether they want to own the front end, give customers a full BI tool or cut cost at scale.',
  },
  {
    href: '/compare/embeddable-alternatives',
    title: 'Embeddable alternatives',
    description:
      'Alternatives grouped by why teams leave Embeddable: owning the UI and data layer in the repo, giving customers a full BI tool, published pricing, or staying on ClickHouse without Cube.',
  },
  {
    href: '/compare/hypequery-vs-embeddable',
    title: 'hypequery vs Embeddable',
    description:
      'Where the data model lives, how tenant isolation is enforced, who owns the UI, and what each serves besides dashboards.',
  },
  {
    href: '/compare/hypequery-vs-luzmo',
    title: 'hypequery vs Luzmo',
    description:
      'Hosted embedded BI with a dashboard editor, or a ClickHouse semantic layer in your repo: data model, tenant isolation, UI ownership, MCP and pricing.',
  },
  {
    href: '/compare/hypequery-vs-querypanel',
    title: 'hypequery vs QueryPanel',
    description:
      'Hosted text-to-SQL with tenant filters, or reviewed metric definitions compiled in your own backend: data flow, tenant isolation, ClickHouse support and pricing.',
  },
  {
    href: '/compare/hypequery-vs-explo',
    title: 'hypequery vs Explo',
    description:
      'Explo is being folded into Omni. The three ways out, how Explo scoped customers, and what rebuilding an Explo dashboard on ClickHouse involves.',
  },
  {
    href: '/cube-js-alternative',
    title: 'Cube alternatives',
    description:
      'Semantic layers compared for embedded analytics and AI agents, covering hypequery, the dbt Semantic Layer, AtScale, GoodData and Boring Semantic Layer.',
  },
];
