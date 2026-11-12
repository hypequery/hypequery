// The hub pages every related page links up to: the nav, the footer,
// blog posts and pillar pages all read their labels from here.

export type HubKey = 'clickhouse' | 'semanticLayer' | 'semanticLayers' | 'embeddedAnalytics';

export type Hub = {
  href: string;
  label: string;
  description: string;
};

export const hubs: Record<HubKey, Hub> = {
  clickhouse: {
    href: '/clickhouse',
    label: 'ClickHouse with TypeScript and Python',
    description: 'Clients, query builders, framework guides and the function reference.',
  },
  semanticLayer: {
    href: '/clickhouse-semantic-layer',
    label: 'ClickHouse semantic layer',
    description: 'Define metrics, dimensions and tenant rules once, in code.',
  },
  // Vendor-neutral: what a semantic layer is and how dbt, Snowflake, Databricks and OSI compare.
  // Blog posts tagged "semantic layer" still file under the ClickHouse page above.
  semanticLayers: {
    href: '/semantic-layer',
    label: 'Semantic layers compared',
    description: 'What a semantic layer is; dbt MetricFlow, Snowflake, Databricks and OSI compared.',
  },
  embeddedAnalytics: {
    href: '/embedded-analytics',
    label: 'Embedded analytics',
    description: 'Customer-facing dashboards: build vs buy, tenancy and vendors.',
  },
};

/** Nav and footer order. */
export const hubList: Hub[] = [hubs.clickhouse, hubs.semanticLayer, hubs.semanticLayers, hubs.embeddedAnalytics];
