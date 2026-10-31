import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse with Django: Governed Analytics in Your Views';
const DESCRIPTION =
  'Query ClickHouse from Django with shared, tenant-scoped definitions. Define measures once in Python, call them from views and tasks, and keep the Django ORM for your transactional data.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-django') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-django'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const viewCode = `# settings.py
INSTALLED_APPS = [..., "hypequery.contrib.django"]
MIDDLEWARE = [
    ...,
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "hypequery.contrib.django.HypequeryMiddleware",
]
# The ClickHouse connection comes from CLICKHOUSE_URL.
HYPEQUERY = {
    "REGISTRY": "analytics.datasets.registry",  # your datasets
    "TENANT": "analytics.tenancy.tenant_for_request",  # request -> org
}

# analytics/tenancy.py
def tenant_for_request(request):
    if request.user.is_authenticated:
        return request.user.organization_id
    return None

# analytics/views.py
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse

@login_required
def revenue_by_status(request):
    # Already scoped to the signed-in user's organization
    result = request.analytics.execute(
        "orders", {"dimensions": ["status"], "measures": ["revenue"]}
    )
    return JsonResponse({"data": list(result.data)})`;

const taskCode = `# analytics/tasks.py — Celery, management commands, scripts
from celery import shared_task
from hypequery.contrib.django import get_client
from hypequery.datasets import tenant


@shared_task
def monthly_report(organization_id):
    # The same definitions and process-wide client the views use;
    # outside a request, the tenant is passed explicitly.
    client = get_client().for_tenant(tenant(organization_id))
    result = client.execute(
        "orders",
        {"dimensions": ["status"], "measures": ["revenue"], "by": "month"},
    )
    return result.to_pandas().to_csv(index=False)`;

export default function ClickHouseDjangoPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse Django"
      title="Use ClickHouse from Django without raw SQL in every view"
      description="The Django ORM is built for your transactional database. For analytics in ClickHouse, hypequery gives your views and tasks named measures and dimensions, scoped to the signed-in customer, from definitions you write once in Python."
      primaryCta={{ href: '/docs/python/django', label: 'Django guide' }}
      secondaryCta={{ href: '/docs/python/quick-start', label: 'Python quick start' }}
      language="python"
      stats={[
        { label: 'Works in', value: 'Sync and async views' },
        { label: 'Tenant from', value: 'request.user' },
        { label: 'Setup', value: 'One app, one middleware' },
      ]}
      problems={[
        {
          title: 'The ORM doesn’t fit ClickHouse',
          copy: 'Django’s ORM expects transactions, migrations, and row updates. Analytics on ClickHouse is aggregations over billions of rows, so teams fall back to raw SQL strings.',
        },
        {
          title: 'Raw SQL spreads through views',
          copy: 'Each view and Celery task writes its own revenue query. They drift, and none of them is reviewed as a definition.',
        },
        {
          title: 'Tenant scoping is manual',
          copy: 'Every query has to remember the organisation filter. The one that forgets shows one customer another customer’s numbers.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Views and tasks',
        title: 'Query named measures from any view',
        description:
          'Add the app and middleware, point `HYPEQUERY` at your datasets, and every view gets `request.analytics`: a client already scoped to the signed-in user’s organisation. The query is planned from your dataset, with the tenant filter added for you.',
        bullets: [
          'Sync views get the sync client; async views get the async one, from the same attribute',
          '`manage.py check` validates the setting without connecting to ClickHouse',
          'A query without a tenant fails instead of reading every customer',
          'Celery tasks use `get_client()` and bind the tenant explicitly',
        ],
        codePanel: {
          eyebrow: 'views.py',
          title: 'A tenant-scoped Django view',
          description: 'The client is built on first use, closed at exit, and rebuilt in each forked worker. Results are plain dicts, ready for JsonResponse or a template.',
          code: viewCode,
          filename: 'analytics/views.py',
        },
      }}
      implementationSection={{
        eyebrow: 'Tasks and commands',
        title: 'The same numbers in Celery, commands and exports',
        description:
          'Outside a request, `get_client()` returns the process-wide client and you bind the tenant explicitly. Reports, exports and scheduled jobs use the same definitions as your views, and `to_pandas()` turns results into typed DataFrames.',
        paragraphs: [
          'The client connects on its first query, is closed when the process exits, and is rebuilt in each forked worker, so gunicorn and Celery prefork pools are safe.',
          'For typed React hooks or the MCP bridge, hypequery’s HTTP endpoints run as their own service today; native Django endpoints that use your Django login are on the way.',
        ],
        codePanel: {
          eyebrow: 'tasks.py',
          title: 'A tenant-scoped Celery task',
          description: 'Results convert to a typed DataFrame for exports.',
          code: taskCode,
          filename: 'analytics/tasks.py',
        },
      }}
      searchIntentCards={[
        { title: 'Django ClickHouse backend', copy: 'You don’t need ClickHouse as a Django database. Keep the ORM on Postgres and query ClickHouse through datasets.' },
        { title: 'Django analytics dashboard', copy: 'Views return measures by dimension and time grain, scoped to the user’s organisation.' },
        { title: 'Celery jobs on ClickHouse', copy: 'Reports and exports use the same definitions as the app, with an explicit tenant for each run.' },
        { title: 'Is there a Django integration?', copy: 'Yes: `hypequery.contrib.django` adds settings, a system check, `request.analytics` middleware, and clients for tasks and commands.' },
      ]}
      readingLinks={[
        { href: '/docs/python/django', title: 'Django guide', description: 'Settings, middleware, async views, and tasks.' },
        { href: '/docs/python/quick-start', title: 'Python quick start', description: 'Install hypequery and define your first dataset.' },
        { href: '/docs/python/datasets/multi-tenancy', title: 'Multi-tenancy', description: 'Tenant keys and tenant-bound clients.' },
        { href: '/docs/python/dataframes', title: 'pandas, Polars and Arrow', description: 'Typed DataFrames for reports and exports.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-flask', label: 'ClickHouse with Flask' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
        { href: '/fastapi-react-analytics', label: 'FastAPI + React' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Replace one raw SQL view',
        description: 'Define the dataset behind one Django report, then swap its SQL for a scoped dataset query.',
        primaryCta: { href: '/docs/python/django', label: 'Django guide' },
        secondaryCta: { href: '/docs/python/quick-start', label: 'Python quick start' },
      }}
    />
  );
}
