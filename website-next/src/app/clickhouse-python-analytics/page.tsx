import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse Analytics in Python: Define Metrics Once';
const DESCRIPTION =
  'Build ClickHouse analytics in Python with named measures, joins, and tenant rules. Query them from jobs and notebooks, and serve them to dashboards and agents.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-python-analytics') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-python-analytics'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const metricsCode = `# pip install "hypequery[clickhouse,jwt]==0.1.0b2"
from hypequery.datasets import Dataset, belongs_to, dimension, filter, formula, measure

customers = Dataset(
    name="customers",
    source="customers",
    tenant_key="tenant_id",
    dimensions={"id": dimension("string"), "plan": dimension("string")},
)

completed = (filter.eq("status", "completed"),)

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "status": dimension("string"),
        "created_at": dimension("timestamp"),
    },
    measures={
        "revenue": measure.sum("amount", filters=completed),
        "completed_orders": measure.count("id", filters=completed),
        "paying_customers": measure.count_distinct("customer_id", filters=completed),
        "average_order_value": measure.derived(
            formula.divide("revenue", formula.null_if_zero("completed_orders")),
        ),
    },
    relationships={
        "customer": belongs_to(customers, from_field="customer_id", to_field="id"),
    },
)`;

const consumersCode = `from hypequery.datasets import (
    ClientQueryProfile,
    MemoryCacheStore,
    ResultCache,
    create_dataset_client,
    create_dataset_registry,
    tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
from hypequery.serve import (
    EndpointPolicy,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
    jwt_strategy,
    to_asgi_app,
)

from analytics.datasets import customers, orders

analytics = create_dataset_client(
    executor=create_clickhouse_executor(ClickHouseConnection.from_env()),
    registry=create_dataset_registry(orders, customers),
    cache=ResultCache(
        store=MemoryCacheStore(max_entries=1_000),
        project="acme",
        environment="production",
        ttl_seconds=300,
    ),
)

# 1. A scheduled job, a notebook, or one of your own routes
report = analytics.for_tenant(tenant("org_123")).execute(
    "orders",
    {
        "dimensions": ["customer.plan"],
        "measures": ["revenue", "paying_customers", "average_order_value"],
        "by": "month",
    },
)

# 2. The same report over HTTP, for React hooks and MCP tools
api = create_api(
    auth=jwt_strategy(
        jwks_url="https://example.auth0.com/.well-known/jwks.json",
        issuer="https://example.auth0.com/",
        audience="https://api.example.com",
    )
)
policy = EndpointPolicy(tenant="required")
add_dataset_endpoint(
    api,
    "/v1/orders",
    dataset=orders,
    client=analytics,
    policy=policy,
    client_profile=ClientQueryProfile(default_limit=50, max_limit=500),
    include_related=("customer",),
)
add_client_contract_endpoint(api, "/v1/client-contract", policy=policy)
app = to_asgi_app(api)  # or app.mount("/analytics", ...) in FastAPI`;

export default function ClickHousePythonAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Python analytics"
      title="Build ClickHouse analytics in Python once, then use it everywhere"
      description="Revenue, paying customers, and average order value start in one script and end up in jobs, notebooks, customer dashboards, and AI agents. hypequery lets you define each metric once in Python, next to your application code, so every consumer gets the same number."
      primaryCta={{ href: '/docs/python/quick-start', label: 'Start with Python' }}
      secondaryCta={{ href: '/clickhouse-fastapi', label: 'Serve it with FastAPI' }}
      language="python"
      stats={[
        { label: 'Defined in', value: 'Python 3.11+' },
        { label: 'Used from', value: 'Jobs, APIs, React, agents' },
        { label: 'Tenancy', value: 'Enforced on every query' },
      ]}
      problems={[
        {
          title: 'The same metric, five implementations',
          copy: 'Revenue lives in a cron job, a notebook, an API handler, and a dashboard query. Each copy filters completed orders slightly differently, and the numbers stop matching.',
        },
        {
          title: 'Joins and ratios get rebuilt by hand',
          copy: 'Revenue by customer plan needs a join. Average order value needs a guarded division. Every new report rewrites both, and every rewrite is a chance to get them wrong.',
        },
        {
          title: 'Customer-facing numbers need hard boundaries',
          copy: 'Once analytics reach customers, a missing tenant filter is a data leak. A convention in SQL strings is not enough when several services query the same tables.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Define',
        title: 'Write the metrics as Python, next to your app',
        description:
          'A dataset maps a ClickHouse table to named dimensions and measures. Filtered measures, derived ratios, and to-one joins are part of the definition, so callers ask for `average_order_value` instead of rebuilding it.',
        bullets: [
          'Sums, counts, exact distinct counts, percentiles, and filtered measures',
          'Derived measures with null-safe division, like average order value',
          '`belongs_to` relationships, so callers can group by `customer.plan`',
          'Tenant and time keys declared once and enforced on every query',
        ],
        codePanel: {
          eyebrow: 'Dataset',
          title: 'Orders, with the metrics your product reports',
          description: 'The `completed` filter is defined once and shared by every measure that needs it.',
          code: metricsCode,
          filename: 'analytics/datasets.py',
        },
      }}
      implementationSection={{
        eyebrow: 'Use',
        title: 'One client for jobs, notebooks, dashboards, and agents',
        description:
          'Query measures by name with a time grain, and hypequery plans parameterized ClickHouse SQL with the join and the tenant predicate on both tables. Serve the same datasets over HTTP when a dashboard or agent needs them.',
        paragraphs: [
          'Results are cached under opaque, tenant-keyed entries, so a dashboard reloading the same chart does not rescan ClickHouse, and two customers never share an entry.',
          'The HTTP endpoint authenticates every request and takes the tenant from the caller, not the request body. `include_related` lets callers group by `customer.plan` over HTTP, and `client_profile` plus the client-contract route are what generated React hooks and the MCP bridge read. See React and MCP clients for exporting the contract.',
        ],
        codePanel: {
          eyebrow: 'Consumers',
          title: 'A monthly report and an authenticated API, from one definition',
          description: '`ClickHouseConnection.from_env()` reads `CLICKHOUSE_URL` or the `CLICKHOUSE_*` variables.',
          code: consumersCode,
          filename: 'analytics/app.py',
        },
      }}
      searchIntentCards={[
        {
          title: 'ClickHouse analytics with Python',
          copy: 'Use a driver like clickhouse-connect for ad hoc SQL. Use hypequery datasets for the metrics other code depends on, so there is one definition to review and change.',
        },
        {
          title: 'Product analytics in a Python backend',
          copy: 'Serve tenant-scoped metrics from FastAPI, Django, Flask, or any ASGI or WSGI app, and render them with typed React hooks.',
        },
        {
          title: 'Not a BI tool',
          copy: 'There is no separate server to run or YAML to maintain. Definitions are Python in your repository, reviewed and tested like the rest of your code.',
        },
        {
          title: 'What is TypeScript-only for now',
          copy: 'Window measures (trailing, to-date, cumulative) and period comparisons are TypeScript only. The Python SDK is in beta; see feature status for the full list.',
        },
      ]}
      readingLinks={[
        { href: '/docs/python/datasets/measures', title: 'Measures', description: 'Aggregations, filtered measures, and derived formulas.' },
        { href: '/docs/python/datasets/relationships', title: 'Relationships', description: 'Group and filter by fields on related datasets.' },
        { href: '/docs/python/datasets/caching', title: 'Caching', description: 'Tenant-safe result caching with opaque keys.' },
        { href: '/docs/python/serving', title: 'Serving', description: 'Authenticated HTTP endpoints from any ASGI or WSGI app.' },
        { href: '/docs/python/client-endpoints', title: 'React and MCP clients', description: 'Export the client contract for typed React hooks and the MCP bridge.' },
        { href: '/fastapi-react-analytics', title: 'FastAPI and React analytics', description: 'Typed React hooks on the endpoints your Python app serves.' },
        { href: '/docs/python/feature-status', title: 'Python feature status', description: 'What ships in the beta, and what is TypeScript-only for now.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
        { href: '/clickhouse-python-multi-tenant', label: 'Multi-tenant Python analytics' },
        { href: '/clickhouse-pandas', label: 'ClickHouse to pandas' },
        { href: '/clickhouse-python-mcp', label: 'ClickHouse MCP for Python' },
        { href: '/clickhouse-analytics', label: 'ClickHouse analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Move one shared metric into a dataset',
        description: 'Pick the number your team argues about most, define it once, and point one job and one dashboard at it.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Get started' },
        secondaryCta: { href: '/docs/python/datasets/overview', label: 'Datasets docs' },
      }}
    />
  );
}
