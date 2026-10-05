import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'A Python Semantic Layer for ClickHouse: Analytics as Code',
  description:
    'Define measures, dimensions, relationships, and tenant rules as Python code. An open-source semantic layer that runs inside your app, with no YAML and no separate server.',
  alternates: { canonical: absoluteUrl('/python-semantic-layer') },
  openGraph: {
    images: ogImage('A Python Semantic Layer for ClickHouse: Analytics as Code'),
    type: 'website',
    url: absoluteUrl('/python-semantic-layer'),
    title: 'A Python Semantic Layer for ClickHouse: Analytics as Code | hypequery',
    description:
      'An open-source semantic layer you define in Python and run inside your app. Query ClickHouse by measure name with tenant isolation built in.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'A Python Semantic Layer for ClickHouse: Analytics as Code | hypequery',
    description:
      'An open-source semantic layer you define in Python and run inside your app. Query ClickHouse by measure name with tenant isolation built in.',
  },
};

const modelCode = `from hypequery.datasets import (
    Dataset,
    belongs_to,
    count_distinct,
    dimension,
    eq,
    measure,
    sum as sum_,
)

customers = Dataset(
    name="customers",
    source="customers",
    dimensions={"id": dimension("string"), "tier": dimension("string")},
)

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    dimensions={"country": dimension("string"), "status": dimension("string")},
    measures={
        "revenue": measure(sum_("amount"), label="Revenue"),
        "us_revenue": measure(sum_("amount"), filters=(eq("country", "US"),)),
        "buyers": measure(count_distinct("customer_id")),
    },
    relationships={
        "customer": belongs_to(customers, from_field="customer_id", to_field="id"),
    },
)`;

const useCode = `from hypequery.datasets import DatasetQuery, create_dataset_client, create_dataset_registry, tenant

analytics = create_dataset_client(
    executor=executor,
    registry=create_dataset_registry(orders, customers),
)

# In a request handler: bind to the caller's tenant first.
scoped = analytics.for_tenant(tenant(org_id))
scoped.execute(
    "orders",
    DatasetQuery(dimensions=("customer.tier",), measures=("revenue", "buyers")),
)`;

export default function PythonSemanticLayerPage() {
  return (
    <ClickhousePillarPage
      eyebrow="Python semantic layer"
      title="A semantic layer you write in Python, not YAML"
      description="hypequery is an open-source semantic layer for ClickHouse that lives in your codebase. Define what revenue, buyers, and enterprise customers mean as Python code, then query those definitions from any part of your app, with tenant isolation enforced on every query."
      primaryCta={{ href: '/docs/python/datasets/overview', label: 'Read the datasets docs' }}
      secondaryCta={{ href: '/clickhouse-python', label: 'ClickHouse with Python' }}
      stats={[
        { label: 'Model format', value: 'Python code' },
        { label: 'Runtime', value: 'Inside your app' },
        { label: 'License', value: 'Apache 2.0' },
      ]}
      problems={[
        {
          title: 'Definitions drift between services',
          copy:
            'When each team writes its own SQL for the same KPI, dashboards and APIs disagree. A semantic layer only helps if every consumer actually reads from it.',
        },
        {
          title: 'Config files sit outside your workflow',
          copy:
            'Models kept in separate YAML files or a separate platform miss the tools your team already relies on: type checks, tests, refactoring, and review alongside the code that uses them.',
        },
        {
          title: 'Another server is another thing to run',
          copy:
            'A standalone semantic-layer service adds deployment, networking, and auth to keep in sync, before it answers a single query.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Model',
        title: 'Your model is Python objects',
        description:
          'Datasets, dimensions, measures, and relationships are immutable Python objects, validated when you create them. They import like any other module and change through the same pull requests as your application.',
        bullets: [
          'Dimensions and measures with labels and descriptions for catalogs and tools',
          'Filtered measures and to-one relationships with automatic joins',
          'Tenant keys enforced from trusted context, never from the query',
          'A catalog of what each dataset exposes, shared with TypeScript',
        ],
        codePanel: {
          eyebrow: 'Model',
          title: 'Two datasets and a relationship',
          description: 'Relationship targets are datasets themselves, so the model is checked when it loads.',
          code: modelCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Use',
        title: 'Query by name, wherever the code runs',
        description:
          'The same definitions serve a nightly job, a notebook, and a FastAPI endpoint. hypequery plans parameterized ClickHouse SQL, joins related datasets, and scopes every query to one tenant.',
        paragraphs: [
          'There is no separate service to deploy. The semantic layer is a library in your process, so it uses your ClickHouse connection, your auth, and your deployment.',
          'Because Python and TypeScript implement the same specifications, a TypeScript service can serve the same model your Python jobs use.',
        ],
        codePanel: {
          eyebrow: 'Query',
          title: 'Group revenue by a related customer field',
          description: 'A tenant-bound client runs every query as that tenant.',
          code: useCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Who this is for',
          copy:
            'Engineering teams who want shared analytics definitions without adopting a BI platform or running another service.',
        },
        {
          title: 'Analytics as code',
          copy:
            'Definitions are versioned, reviewed, and tested like application code, because they are application code.',
        },
        {
          title: 'Open source',
          copy:
            'Apache 2.0 licensed. Run it entirely in your own infrastructure against your own ClickHouse.',
        },
        {
          title: 'Serving is optional',
          copy:
            'Query datasets in-process, or add the FastAPI router when dashboards, customers, or agents need HTTP access.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/python/datasets/defining-datasets',
          title: 'Defining datasets',
          description: 'The Python dataset model and its fields.',
        },
        {
          href: '/docs/python/datasets/relationships',
          title: 'Relationships',
          description: 'Join related datasets and query their fields by name.',
        },
        {
          href: '/clickhouse-semantic-layer',
          title: 'ClickHouse semantic layer',
          description: 'The semantic layer concept and the TypeScript side of hypequery.',
        },
        {
          href: '/clickhouse-fastapi',
          title: 'ClickHouse FastAPI',
          description: 'Serve your Python model as authenticated HTTP endpoints.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse Python' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse FastAPI' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse semantic layer' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-tenant analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Define your most-used metric as a measure',
        description:
          'Start with the number your team argues about most, model it once in Python, and point every consumer at the definition.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Start with Python' },
        secondaryCta: { href: '/docs/python/datasets/measures', label: 'Measures docs' },
      }}
    />
  );
}
