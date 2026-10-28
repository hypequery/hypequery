import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse with Flask: Shared Analytics Definitions for Your Routes';
const DESCRIPTION =
  'Serve ClickHouse analytics from Flask without copying SQL between routes. Define measures once in Python, query them per customer, and turn results into typed DataFrames for exports.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-flask') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-flask'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const routeCode = `from flask import Flask
from flask_login import current_user
from hypequery.contrib.flask import Hypequery

hq = Hypequery()


@hq.tenant_loader
def current_tenant():
    return current_user.org_id if current_user.is_authenticated else None


def create_app():
    app = Flask(__name__)
    app.config["HYPEQUERY_REGISTRY"] = "analytics.datasets:registry"
    hq.init_app(app)  # connection from HYPEQUERY_URL or CLICKHOUSE_URL

    @app.get("/reports/revenue")
    def revenue():
        # hq.client is scoped to the current user's organization
        result = hq.client.execute(
            "orders", {"dimensions": ["country"], "measures": ["revenue"]}
        )
        return {"data": list(result.data)}

    return app`;

const exportCode = `import io

from flask import Response


@app.get("/reports/revenue.csv")
def revenue_csv():
    # Scoped by the tenant loader, typed by the dataset definition
    result = hq.client.execute("orders", {"measures": ["revenue"], "by": "day"})
    frame = result.to_pandas()  # period: datetime64[us, UTC], revenue: float64
    buffer = io.StringIO()
    frame.to_csv(buffer, index=False)
    return Response(buffer.getvalue(), mimetype="text/csv")`;

export default function ClickHouseFlaskPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Flask"
      title="ClickHouse analytics in Flask routes, defined once"
      description="Flask keeps your routes small. hypequery keeps your ClickHouse analytics small too: measures and dimensions defined once in Python, queried by name from any route, and scoped to the customer making the request."
      primaryCta={{ href: '/docs/python/flask', label: 'Flask guide' }}
      secondaryCta={{ href: '/docs/python/quick-start', label: 'Python quick start' }}
      language="python"
      stats={[
        { label: 'Works in', value: 'Any Flask route' },
        { label: 'Tenant from', value: 'A tenant loader' },
        { label: 'Exports', value: 'Typed pandas DataFrames' },
      ]}
      problems={[
        {
          title: 'SQL strings in every route',
          copy: 'Each report route builds its own ClickHouse query. Renaming a column or changing what “revenue” means touches all of them.',
        },
        {
          title: 'Request parsing is hand-rolled',
          copy: 'Filters, groupings, and page sizes come from query strings, and each route validates them differently, or not at all.',
        },
        {
          title: 'Customer scoping depends on memory',
          copy: 'If a route forgets the organisation filter, it returns every customer’s data.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Flask routes',
        title: 'Query datasets from your routes',
        description:
          'Register the extension and a tenant loader. `hq.client` is then bound to the current customer in each request. hypequery plans and validates the query from your dataset, then adds the tenant filter.',
        bullets: [
          'Config comes from `app.config` or `CLICKHOUSE_URL`, and `init_app` validates it at startup',
          '`async def` routes use `hq.async_client`; the tenant loader runs once per request',
          'Queries without a tenant fail instead of reading every customer',
          'One client per process, closed at exit, never per request',
        ],
        codePanel: {
          eyebrow: 'app.py',
          title: 'A tenant-scoped Flask route',
          description: 'Flask-Login’s `current_user` stands in for your own auth.',
          code: routeCode,
          filename: 'app.py',
        },
      }}
      implementationSection={{
        eyebrow: 'Exports',
        title: 'CSV and DataFrame exports from the same definitions',
        description:
          'Results convert to typed pandas, Polars or Arrow frames using the dataset definition, so an export route is a few lines and its numbers match the dashboard.',
        paragraphs: [
          '`pip install "hypequery[flask,pandas]"`. Decimals become floats by default; pass `decimals="decimal"` to keep them exact.',
          'For typed React hooks or the MCP bridge, hypequery’s HTTP endpoints run as their own service today; a native Flask blueprint that uses your Flask login is on the way.',
        ],
        codePanel: {
          eyebrow: 'app.py',
          title: 'A tenant-scoped CSV export',
          description: 'The route reads the same tenant as every other route.',
          code: exportCode,
          filename: 'app.py',
        },
      }}
      searchIntentCards={[
        { title: 'Flask ClickHouse API', copy: 'Return measures by dimension from Flask routes, scoped to the signed-in customer.' },
        { title: 'Flask analytics dashboard', copy: 'Back a dashboard with named measures so every chart uses the same definition.' },
        { title: 'clickhouse-connect in Flask', copy: 'hypequery runs on clickhouse-connect. You get the same driver, plus planning, validation, and tenancy on top.' },
        { title: 'Is there a Flask extension?', copy: 'Yes: `hypequery.contrib.flask.Hypequery` supports app factories, `app.config`, a tenant loader, and async routes.' },
      ]}
      readingLinks={[
        { href: '/docs/python/flask', title: 'Flask guide', description: 'The extension, tenant loader and async routes.' },
        { href: '/docs/python/quick-start', title: 'Python quick start', description: 'Install hypequery and define your first dataset.' },
        { href: '/docs/python/datasets/multi-tenancy', title: 'Multi-tenancy', description: 'Tenant keys and tenant-bound clients.' },
        { href: '/docs/python/dataframes', title: 'pandas, Polars and Arrow', description: 'Typed DataFrames for exports.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-django', label: 'ClickHouse with Django' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Move one Flask report onto a dataset',
        description: 'Define the dataset behind your busiest report route, then replace its SQL with a scoped query.',
        primaryCta: { href: '/docs/python/flask', label: 'Flask guide' },
        secondaryCta: { href: '/docs/python/quick-start', label: 'Python quick start' },
      }}
    />
  );
}
