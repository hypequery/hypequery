import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse with SQLAlchemy: Where a Semantic Layer Fits';
const DESCRIPTION =
  'SQLAlchemy builds queries. hypequery defines what your metrics mean. Use both against ClickHouse: SQLAlchemy for ad hoc SQL, hypequery for shared, tenant-scoped measures.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-sqlalchemy') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-sqlalchemy'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const sideBySideCode = `from sqlalchemy import func, select

# SQLAlchemy: you write the query, every time
stmt = (
    select(orders_table.c.status, func.sum(orders_table.c.amount).label("revenue"))
    .where(orders_table.c.org_id == org_id)  # don't forget this one
    .group_by(orders_table.c.status)
)

# hypequery: you name the measure; the definition and tenant filter are shared
from hypequery.datasets import tenant

result = analytics.for_tenant(tenant(org_id)).execute(
    "orders", {"dimensions": ["status"], "measures": ["revenue"]}
)`;

const engineCode = `from sqlalchemy import create_engine
from hypequery.contrib.sqlalchemy import executor_from_engine
from hypequery.datasets import create_dataset_client

# clickhouse-connect's dialect, or clickhouse-sqlalchemy's clickhouse+http://
engine = create_engine("clickhousedb://user:password@host:8123/analytics")

# hypequery opens its own HTTP clients for the engine's server;
# it never borrows a connection from the engine's pool.
analytics = create_dataset_client(
    executor=executor_from_engine(engine),
    registry=registry,
)`;

export default function ClickHouseSqlAlchemyPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse SQLAlchemy"
      title="SQLAlchemy writes queries. hypequery defines your metrics."
      description="If you use SQLAlchemy with ClickHouse, you already have a good way to build SQL. What you don’t have is one shared definition of revenue, scoped to the right customer. hypequery adds that layer next to SQLAlchemy, not instead of it."
      primaryCta={{ href: '/docs/python/sqlalchemy', label: 'SQLAlchemy guide' }}
      secondaryCta={{ href: '/python-semantic-layer', label: 'Python semantic layer' }}
      language="python"
      stats={[
        { label: 'Replaces SQLAlchemy?', value: 'No, it sits beside it' },
        { label: 'Driver', value: 'clickhouse-connect' },
        { label: 'Adds', value: 'Measures, validation, tenancy' },
      ]}
      problems={[
        {
          title: 'Query builders don’t hold meaning',
          copy: 'SQLAlchemy can express any aggregation, but it doesn’t know which one is “revenue”. Every caller rebuilds it.',
        },
        {
          title: 'Each query re-applies the rules',
          copy: 'Tenant filters, completed-order conditions, and timezone bucketing are repeated in every statement.',
        },
        {
          title: 'Callers can ask for anything',
          copy: 'An API built on a query builder needs its own allow-list of fields, filters, and limits. That’s a second definition to maintain.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Side by side',
        title: 'Write SQL when you need it. Name measures when they’re shared.',
        description:
          'Keep SQLAlchemy for one-off and operational queries. Put the numbers your product, reports, and agents share into datasets.',
        bullets: [
          'Measures and dimensions are defined once and reviewed as code',
          'Callers pick fields by name; anything undeclared is rejected',
          'The tenant filter is added for you and can’t be widened from a query',
          'Python has no hypequery query builder, so SQLAlchemy stays your tool for raw SQL',
        ],
        codePanel: {
          eyebrow: 'compare.py',
          title: 'The same report, two ways',
          description: '`orders_table` is a SQLAlchemy `Table`; `orders` is a hypequery dataset.',
          code: sideBySideCode,
          filename: 'reports.py',
        },
      }}
      implementationSection={{
        eyebrow: 'One engine, one config',
        title: 'Point hypequery at your engine’s server',
        description:
          '`executor_from_engine` reads your engine’s URL and connects hypequery to the same ClickHouse server, with its own HTTP clients, so closing one never affects the other. Works with `clickhousedb://` and `clickhouse+http://` engines.',
        paragraphs: [
          'hypequery sends values as ClickHouse server-side parameters, which only the HTTP interface carries, so `clickhouse+native://` engines are refused with an explanation. Use an HTTP-interface URL for hypequery, usually port 8123 or 8443.',
          'hypequery does not read SQLAlchemy `Table` metadata yet. Generate datasets from your live ClickHouse schema with `hypequery generate datasets` instead.',
        ],
        codePanel: {
          eyebrow: 'engine.py',
          title: 'hypequery and SQLAlchemy on one server',
          description: 'The same URLs also work directly with `ClickHouseConnection.from_url()`.',
          code: engineCode,
          filename: 'analytics/engine.py',
        },
      }}
      searchIntentCards={[
        { title: 'clickhouse-sqlalchemy vs hypequery', copy: 'clickhouse-sqlalchemy is a dialect for building SQL. hypequery is a semantic layer for shared measures. Many teams want both.' },
        { title: 'SQLAlchemy ORM for ClickHouse analytics', copy: 'ORMs map rows to objects. Analytics wants aggregations by dimension, which is what datasets describe.' },
        { title: 'Using one ClickHouse config', copy: '`executor_from_engine(engine)` points hypequery at the server your `clickhousedb://` or `clickhouse+http://` engine uses.' },
        { title: 'Generate models from SQLAlchemy?', copy: 'Not today. Datasets are generated from the live ClickHouse schema, or written by hand.' },
      ]}
      readingLinks={[
        { href: '/docs/python/sqlalchemy', title: 'SQLAlchemy guide', description: 'Engines, supported dialects, and URLs.' },
        { href: '/docs/python/quick-start', title: 'Python quick start', description: 'Install hypequery and define your first dataset.' },
        { href: '/docs/python/cli', title: 'Python CLI', description: 'Generate datasets from your ClickHouse schema.' },
        { href: '/compare/hypequery-vs-clickhouse-connect', title: 'hypequery vs clickhouse-connect', description: 'Driver or semantic layer: what each one is for.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-pandas', label: 'ClickHouse to pandas' },
        { href: '/clickhouse-django', label: 'ClickHouse with Django' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Move one shared number into a dataset',
        description: 'Find the aggregation you copy most often, define it as a measure, and query it by name.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Get started' },
        secondaryCta: { href: '/docs/python/cli', label: 'Generate datasets' },
      }}
    />
  );
}
