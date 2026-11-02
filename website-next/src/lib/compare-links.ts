/** Where a comparison page sends readers next, by who the comparison is for. */

type Link = { href: string; title: string; description: string };

export type CompareLinks = {
  primary: { href: string; label: string; target: string };
  secondary: { href: string; label: string };
  body: { href: string; label: string };
  nextStep: { title: string; description: string };
  related: Link[];
};

const PYTHON_SLUGS = new Set(['hypequery-vs-clickhouse-connect']);
// Products that serve any language, so neither SDK is the obvious next step.
const NEUTRAL_SLUGS = new Set([
  'hypequery-vs-cube',
  'hypequery-vs-tinybird',
  'clickhouse-cloud-vs-tinybird',
  'cube-vs-tinybird-vs-hypequery',
  'hypequery-vs-moose',
  'hypequery-vs-dbt',
  'hypequery-vs-propel',
]);

const COMPARE_HUB: Link = {
  href: '/compare',
  title: 'Compare more options',
  description: 'Return to the comparison hub if you want to evaluate the other path next.',
};

export function compareLinksFor(slug: string): CompareLinks {
  if (PYTHON_SLUGS.has(slug)) {
    return {
      primary: { href: '/docs/python/quick-start', label: 'Start with the Python quick start', target: 'docs_python_quick_start' },
      secondary: { href: '/clickhouse-python', label: 'ClickHouse with Python' },
      body: { href: '/python-semantic-layer', label: 'Python semantic layer' },
      nextStep: {
        title: 'Move from evaluation to your first Python dataset',
        description: 'Define a dataset over a table you already have, query it by name, and serve it from FastAPI, Django, or Flask.',
      },
      related: [
        { href: '/docs/python/quick-start', title: 'Python quick start', description: 'Define a dataset and run your first semantic query from Python.' },
        { href: '/clickhouse-python', title: 'ClickHouse with Python', description: 'How hypequery fits next to the driver you already use.' },
        { href: '/python-semantic-layer', title: 'Python semantic layer', description: 'Datasets served from FastAPI, Django, or Flask, and used from notebooks.' },
        COMPARE_HUB,
      ],
    };
  }
  if (NEUTRAL_SLUGS.has(slug)) {
    return {
      primary: { href: '/docs', label: 'Get started', target: 'docs_home' },
      secondary: { href: '/clickhouse-semantic-layer', label: 'See the semantic layer' },
      body: { href: '/clickhouse-semantic-layer', label: 'ClickHouse semantic layer' },
      nextStep: {
        title: 'Move from evaluation to your first dataset',
        description: 'Define a dataset in TypeScript or Python, query it by name, and decide whether it runs in-process or over HTTP.',
      },
      related: [
        { href: '/docs', title: 'Get started', description: 'Pick TypeScript or Python and define your first dataset.' },
        { href: '/clickhouse-semantic-layer', title: 'ClickHouse semantic layer', description: 'Datasets, tenant rules, and one definition behind every API and agent.' },
        { href: '/python-semantic-layer', title: 'Python semantic layer', description: 'The same datasets, defined and served from Python.' },
        COMPARE_HUB,
      ],
    };
  }
  return {
    primary: { href: '/docs/quick-start', label: 'Start with the quick start', target: 'docs_quick_start' },
    secondary: { href: '/clickhouse-query-builder', label: 'See the query builder' },
    body: { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
    nextStep: {
      title: 'Move from evaluation into a typed ClickHouse workflow',
      description: 'Generate schema types, define your first reusable query, and decide whether it should run locally or over HTTP.',
    },
    related: [
      { href: '/docs/quick-start', title: 'Quick start', description: 'Move from evaluation to implementation with generated schema types and your first typed query.' },
      { href: '/clickhouse-typescript', title: 'ClickHouse TypeScript', description: 'The broader workflow for reusable queries, HTTP APIs, and runtime type safety.' },
      COMPARE_HUB,
    ],
  };
}
