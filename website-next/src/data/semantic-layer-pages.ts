// The vendor-neutral semantic layer hub and its spokes. The hub, each spoke's
// "other guides" grid, the sitemap and llms.txt all read from this list.

export type SemanticLayerPage = {
  href: string;
  /** Short label for cards, breadcrumbs and the nav. */
  label: string;
  description: string;
};

export const semanticLayerHub: SemanticLayerPage = {
  href: '/semantic-layer',
  label: 'What is a semantic layer',
  description:
    'What a semantic layer is, the five places one can live, and how dbt MetricFlow, Snowflake semantic views, Databricks metric views and OSI compare with a layer defined in code.',
};

export const semanticLayerSpokes: SemanticLayerPage[] = [
  {
    href: '/semantic-layer/dbt-metricflow',
    label: 'dbt Semantic Layer and MetricFlow',
    description: 'Semantic models, metric types and the Semantic Layer APIs, compared with a semantic layer defined in code.',
  },
  {
    href: '/semantic-layer/snowflake-semantic-views',
    label: 'Snowflake semantic views',
    description: 'CREATE SEMANTIC VIEW, the SEMANTIC_VIEW() query and Cortex Analyst, compared with a semantic layer defined in code.',
  },
  {
    href: '/semantic-layer/databricks-metric-views',
    label: 'Databricks metric views',
    description: 'Unity Catalog metric views in YAML, the MEASURE() function and Genie, compared with a semantic layer defined in code.',
  },
  {
    href: '/semantic-layer/open-semantic-interchange',
    label: 'Open Semantic Interchange (OSI)',
    description: 'The vendor-neutral spec for exchanging semantic models: who is behind it, what the format covers and what it leaves out.',
  },
];

export const semanticLayerPages: SemanticLayerPage[] = [semanticLayerHub, ...semanticLayerSpokes];

/** Card links to the hub and the other spokes, for the "more guides" grid on a spoke. */
export function otherSemanticLayerPages(currentHref: string) {
  return semanticLayerPages
    .filter((page) => page.href !== currentHref)
    .map((page) => ({ href: page.href, title: page.label, description: page.description }));
}
