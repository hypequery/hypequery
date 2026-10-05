import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse with Python: A Semantic Layer, Not Just a Driver',
  description:
    'Define ClickHouse measures, dimensions, and tenant rules once in Python, then query them by name from jobs, notebooks, and FastAPI services.',
  alternates: { canonical: absoluteUrl('/clickhouse-python') },
  openGraph: {
    images: ogImage('ClickHouse with Python: A Semantic Layer, Not Just a Driver'),
    type: 'website',
    url: absoluteUrl('/clickhouse-python'),
    title: 'ClickHouse with Python: A Semantic Layer, Not Just a Driver | hypequery',
    description:
      'Model ClickHouse analytics as Python code. Query measures by name with tenant isolation, caching, and parameterized SQL generated for you.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse with Python: A Semantic Layer, Not Just a Driver | hypequery',
    description:
      'Model ClickHouse analytics as Python code. Query measures by name with tenant isolation, caching, and parameterized SQL generated for you.',
  },
};

const datasetCode = `from hypequery.datasets import Dataset, count, dimension, measure, sum as sum_

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "country": dimension("string"),
        "status": dimension("string"),
        "created_at": dimension("timestamp"),
    },
    measures={
        "revenue": measure(sum_("amount")),
        "order_count": measure(count("id")),
    },
)`;

const queryCode = `from hypequery.datasets import DatasetQuery, ExecutionContext, create_dataset_client, eq, tenant
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

executor = create_clickhouse_executor(
    ClickHouseConnection(host="localhost", database="analytics")
)
analytics = create_dataset_client(executor=executor)

result = analytics.execute(
    orders,
    DatasetQuery(
        dimensions=("country",),
        measures=("revenue", "order_count"),
        filters=(eq("status", "completed"),),
        by="month",
    ),
    context=ExecutionContext(tenant=tenant("org_123")),
)
result.data  # rows keyed by column name`;

export default function ClickHousePythonPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Python"
      title="Use ClickHouse from Python with a semantic layer, not just a driver"
      description="A driver gets rows out of ClickHouse. hypequery gives your Python code shared definitions on top: measures, dimensions, relationships, and tenant rules you define once and query by name from jobs, notebooks, and FastAPI services."
      primaryCta={{ href: '/docs/python/quick-start', label: 'Start with Python' }}
      secondaryCta={{ href: '/clickhouse-fastapi', label: 'See the FastAPI guide' }}
      stats={[
        { label: 'Python', value: '3.11+' },
        { label: 'Execution', value: 'Sync and async ClickHouse' },
        { label: 'Serving', value: 'FastAPI router' },
      ]}
      problems={[
        {
          title: 'Every service rewrites the same SQL',
          copy:
            'Revenue, active users, and churn end up as string templates copied across jobs, notebooks, and API handlers. Each copy drifts, and nobody is sure which one is right.',
        },
        {
          title: 'Tenant filters depend on remembering them',
          copy:
            'In a multi-tenant product, every query needs a tenant predicate. With raw SQL that is a convention, and one forgotten WHERE clause is a data leak.',
        },
        {
          title: 'Drivers stop at rows',
          copy:
            'A ClickHouse driver connects and returns results. It does not know what revenue means, which fields callers may group by, or how to cache an answer safely per tenant.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Define',
        title: 'Model a table once as a dataset',
        description:
          'A dataset maps a ClickHouse table to named dimensions and measures. It is plain Python, so it lives in your repository, goes through code review, and is tested in CI like the rest of your application.',
        bullets: [
          'Dimensions, measures, filtered measures, and relationships',
          'Tenant and time keys declared on the dataset, enforced on every query',
          'Validated when you define it, so typos fail before production',
          'The same semantic model and artifacts as the TypeScript SDK',
        ],
        codePanel: {
          eyebrow: 'Dataset',
          title: 'A ClickHouse table with named measures',
          description: 'Import `sum`, `min`, and `max` under aliases so they do not shadow the Python built-ins.',
          code: datasetCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Query',
        title: 'Ask for measures by name, and let hypequery write the SQL',
        description:
          'Queries select semantic names. hypequery plans parameterized ClickHouse SQL, adds the tenant predicate from a trusted execution context, and returns rows keyed by column name.',
        paragraphs: [
          'Because the tenant comes from the execution context rather than the query, a request body or notebook cell cannot widen its own access. A query without tenant context against a tenant-scoped dataset is rejected outright.',
          'The same client supports result caching with tenant-safe keys, validation without execution, and a redacted SQL preview for debugging.',
        ],
        codePanel: {
          eyebrow: 'Execution',
          title: 'A tenant-scoped query against ClickHouse',
          description: 'Execution uses clickhouse-connect underneath. Async code can use the async client and executor instead.',
          code: queryCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Who this is for',
          copy:
            'Python teams that query ClickHouse from more than one place and want shared definitions instead of copied SQL.',
        },
        {
          title: 'How it relates to clickhouse-connect',
          copy:
            'It builds on the driver rather than replacing it. Keep the driver for ad hoc SQL, and use datasets for analytics that other code depends on.',
        },
        {
          title: 'When to add serving',
          copy:
            'When a dashboard, customer, or agent needs the same numbers over HTTP. The FastAPI router serves datasets without new query code.',
        },
        {
          title: 'TypeScript too',
          copy:
            'Python and TypeScript share the same specifications and conformance fixtures, so mixed-language teams can share one model.',
        },
      ]}
      readingLinks={[
        {
          href: '/clickhouse-fastapi',
          title: 'ClickHouse FastAPI',
          description: 'Serve Python datasets as authenticated, tenant-scoped HTTP endpoints.',
        },
        {
          href: '/python-semantic-layer',
          title: 'Python semantic layer',
          description: 'Why define analytics as Python code instead of YAML or a separate server.',
        },
        {
          href: '/docs/python/datasets/overview',
          title: 'Python datasets docs',
          description: 'Dimensions, measures, relationships, caching, and multi-tenancy in Python.',
        },
        {
          href: '/clickhouse-multi-tenant-analytics',
          title: 'Multi-tenant ClickHouse analytics',
          description: 'Patterns for isolating customers in shared ClickHouse tables.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-fastapi', label: 'ClickHouse FastAPI' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse semantic layer' },
        { href: '/clickhouse-typescript', label: 'ClickHouse TypeScript' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Model one table and replace one query',
        description:
          'Pick the ClickHouse query your team copies most often, define it as a dataset, and point one job or endpoint at it.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Start with Python' },
        secondaryCta: { href: '/docs/python', label: 'Read the Python docs' },
      }}
    />
  );
}
