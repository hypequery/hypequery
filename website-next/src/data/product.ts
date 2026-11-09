import { absoluteUrl } from '@/lib/site';

/**
 * The one definition of hypequery that answer engines should see. It opens /docs/what-is-hypequery, the
 * llms.txt summary, and the structured data below. Keep the first paragraph of
 * docs/(getting-started)/what-is-hypequery.mdx and the root README.md word-for-word identical to this string.
 */
export const PRODUCT_DEFINITION =
  'hypequery is an open-source analytics layer for ClickHouse that runs inside your own application. You define datasets in TypeScript or Python (beta), with their dimensions, measures, metrics, and tenant rules, then query them by name and serve them as authenticated HTTP endpoints with OpenAPI, typed React hooks, and MCP tools for AI agents. The TypeScript SDK also includes a type-safe ClickHouse query builder. It is for engineers building dashboards, APIs, and agent tools on their own ClickHouse. hypequery is not a hosted BI tool, not a database, and not a separate semantic-layer server: it is a set of Apache 2.0 libraries you install and deploy with your backend.';

export const WHAT_IS_URL = '/docs/what-is-hypequery';

const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';
const REPOSITORY_URL = 'https://github.com/hypequery/hypequery';

/** The product as a schema.org entity. The homepage and the what-is page share this `@id`. */
export const softwareApplicationSchema = {
  '@type': 'SoftwareApplication',
  '@id': absoluteUrl('/#software').toString(),
  name: 'hypequery',
  // A common misspelling; searches for it should still find the product.
  alternateName: 'hyperquery',
  url: absoluteUrl('/').toString(),
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Cross-platform',
  description: PRODUCT_DEFINITION,
  license: LICENSE_URL,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  softwareHelp: absoluteUrl('/docs').toString(),
  downloadUrl: 'https://www.npmjs.com/package/@hypequery/clickhouse',
  author: { '@id': absoluteUrl('/#organization').toString() },
  publisher: { '@id': absoluteUrl('/#organization').toString() },
};

/** The open-source repository behind the product. */
export const softwareSourceCodeSchema = {
  '@type': 'SoftwareSourceCode',
  '@id': absoluteUrl('/#source-code').toString(),
  name: 'hypequery',
  description: PRODUCT_DEFINITION,
  codeRepository: REPOSITORY_URL,
  license: LICENSE_URL,
  programmingLanguage: ['TypeScript', 'Python'],
  runtimePlatform: ['Node.js', 'Python 3.11+'],
  targetProduct: { '@id': absoluteUrl('/#software').toString() },
  author: { '@id': absoluteUrl('/#organization').toString() },
};
