import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse to pandas: Governed Metrics in Your Notebooks';
const DESCRIPTION =
  'Pull ClickHouse measures into pandas from the same definitions your product uses. Query revenue by month by name, not by copying SQL into a notebook.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-pandas') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-pandas'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const notebookCode = `# pip install "hypequery[clickhouse,pandas]"
from hypequery.datasets import create_dataset_client, tenant
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

from analytics.datasets import registry  # the definitions your app uses

analytics = create_dataset_client(
    executor=create_clickhouse_executor(ClickHouseConnection.from_env()),
    registry=registry,
)

result = analytics.for_tenant(tenant("org_123")).execute(
    "orders", {"measures": ["revenue", "order_count"], "by": "month"}
)

df = result.to_pandas()   # or result.to_polars(), result.to_arrow()`;

const typesCode = `df.dtypes
# period         datetime64[us, UTC]
# revenue                    float64
# order_count                  Int64

#                      period     revenue  order_count
# 0 2025-01-01 00:00:00+00:00  2876716.62         5693
# 1 2025-02-01 00:00:00+00:00  2486385.87         5028

# Keep ClickHouse decimals exact instead of floats:
result.to_pandas(decimals="decimal")

# Internal analysis across every customer has to say so explicitly:
from hypequery.datasets import ExecutionContext, all_tenants

analytics.execute("orders", {"measures": ["revenue"], "by": "month"},
                  context=ExecutionContext(tenant=all_tenants())).to_pandas()`;

export default function ClickHousePandasPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse pandas"
      title="Get governed ClickHouse metrics into pandas, by name"
      description="Notebooks are where numbers drift. hypequery lets analysts query the same measures and dimensions your product and dashboards use, so a DataFrame of “revenue by month” matches what customers see."
      primaryCta={{ href: '/docs/python/dataframes', label: 'DataFrames guide' }}
      secondaryCta={{ href: '/python-semantic-layer', label: 'Python semantic layer' }}
      language="python"
      stats={[
        { label: 'Works in', value: 'Jupyter, scripts, jobs' },
        { label: 'Output', value: 'pandas, Polars, Arrow' },
        { label: 'Types', value: 'From your definitions' },
      ]}
      problems={[
        {
          title: 'Every notebook has its own revenue',
          copy: 'Analysts copy a SQL query from a dashboard, tweak it, and the number in the deck no longer matches the product.',
        },
        {
          title: 'Joins and filters get re-derived',
          copy: 'Each analysis rediscovers which status counts as completed, which table holds refunds, and how to bucket by week.',
        },
        {
          title: 'Customer data needs a deliberate scope',
          copy: 'A notebook that forgets the tenant filter silently mixes customers. Cross-customer analysis should be explicit.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Notebook',
        title: 'Query the definitions, not the tables',
        description:
          'Import the datasets your application defines, query measures by name with a time grain, and call `to_pandas()`.',
        bullets: [
          'Measures, filters, and relationships come from reviewed code',
          'Time grains like `by="month"` produce a timezone-aware `period` column',
          '`to_polars()` and `to_arrow()` work the same way',
          'The same query runs in a scheduled job without changes',
        ],
        codePanel: {
          eyebrow: 'notebook',
          title: 'Revenue by month into a DataFrame',
          description: '`ClickHouseConnection.from_env()` reads `CLICKHOUSE_URL` or the `CLICKHOUSE_*` variables.',
          code: notebookCode,
          filename: 'analysis.ipynb',
        },
      }}
      implementationSection={{
        eyebrow: 'Types and scope',
        title: 'Typed columns, from the definition',
        description:
          'Each column’s type comes from the dataset, not from guessing at values: time buckets become datetimes in the query’s timezone, counts nullable integers, other measures floats. An empty result gets the same dtypes.',
        paragraphs: [
          'Pass `decimals="decimal"` to keep ClickHouse decimals exact. Integers beyond Int64 become unsigned or exact columns rather than overflowing.',
          'Tenant-scoped datasets require a tenant. For internal analysis across every customer, pass `all_tenants()` explicitly so the intent is visible in the code.',
        ],
        codePanel: {
          eyebrow: 'notebook',
          title: 'Typed columns and cross-customer analysis',
          description: 'Output shown from a sample orders table.',
          code: typesCode,
          filename: 'analysis.ipynb',
        },
      }}
      searchIntentCards={[
        { title: 'ClickHouse to pandas DataFrame', copy: 'Query measures through hypequery and call `result.to_pandas()` for typed columns.' },
        { title: 'Metrics layer for notebooks', copy: 'Analysts and the product read the same definitions, so numbers match across decks and dashboards.' },
        { title: 'clickhouse-connect query_df', copy: 'clickhouse-connect returns DataFrames for raw SQL. hypequery returns them for named measures, with validation and tenancy.' },
        { title: 'Polars or Arrow?', copy: '`result.to_polars()` and `result.to_arrow()` use the same column types. Install `hypequery[polars]` or `hypequery[arrow]`.' },
      ]}
      readingLinks={[
        { href: '/docs/python/dataframes', title: 'pandas, Polars and Arrow', description: 'Column types, timezones, and exact decimals.' },
        { href: '/docs/python/quick-start', title: 'Python quick start', description: 'Install hypequery and define your first dataset.' },
        { href: '/docs/python/datasets/time-grains', title: 'Time grains', description: 'Bucket measures by day, week, or month.' },
        { href: '/docs/python/datasets/caching', title: 'Caching', description: 'Reuse results across notebook runs.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
        { href: '/clickhouse-sqlalchemy', label: 'ClickHouse with SQLAlchemy' },
        { href: '/clickhouse-time-series', label: 'ClickHouse time series' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Rebuild one notebook query on a dataset',
        description: 'Pick the query behind your most-shared chart, define it as a dataset, and compare the numbers.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Get started' },
        secondaryCta: { href: '/docs/python/datasets/measures', label: 'Measures docs' },
      }}
    />
  );
}
