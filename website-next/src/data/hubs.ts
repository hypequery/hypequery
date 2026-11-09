// The three hub pages every related page links up to: the nav, the footer,
// blog posts and pillar pages all read their labels from here.

export type HubKey = 'clickhouse' | 'semanticLayer' | 'embeddedAnalytics';

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
  embeddedAnalytics: {
    href: '/embedded-analytics',
    label: 'Embedded analytics',
    description: 'Customer-facing dashboards: build vs buy, tenancy and vendors.',
  },
};

/** Nav and footer order. */
export const hubList: Hub[] = [hubs.clickhouse, hubs.semanticLayer, hubs.embeddedAnalytics];
