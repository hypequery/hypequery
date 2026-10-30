import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'Multi-Tenant ClickHouse Analytics in Python';
const DESCRIPTION =
  'Scope every ClickHouse query to the right customer from Python. Declare a tenant key once; hypequery adds the filter and refuses queries without a trusted tenant.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-python-multi-tenant') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-python-multi-tenant'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const datasetCode = `from hypequery.datasets import Dataset, dimension, measure

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="org_id",  # every query is scoped by this column
    time_key="created_at",
    dimensions={
        "status": dimension("string"),
        "country": dimension("string"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "order_count": measure.count("order_id"),
    },
)`;

const serveCode = `from hypequery.datasets import tenant
from hypequery.serve import (
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    create_api,
)


def resolve_tenant(principal: Principal):
    org_id = lookup_org(principal.subject)  # your code
    return tenant(org_id) if org_id else None


api = create_api(
    auth=authenticate,
    tenant=resolve_tenant,
    security=HttpSecurity(allowed_hosts=("analytics.example.com",)),
)
add_dataset_endpoint(
    api,
    "/datasets/orders/query",
    dataset=orders,
    client=analytics,
    policy=EndpointPolicy(
        tenant="required"
    ),  # tenant-free callers are refused
)
# Mount api in FastAPI, Django, Flask, or any ASGI or WSGI server.`;

export default function ClickHousePythonMultiTenantPage() {
  return (
    <ClickhousePillarPage
      eyebrow="Python multi-tenancy"
      title="Multi-tenant ClickHouse analytics in Python, without a filter to forget"
      description="Declare the tenant column once on the dataset. Every query from your jobs, FastAPI endpoints, and agents runs inside one customer's data, and a query without a trusted tenant fails instead of returning everyone's rows."
      primaryCta={{ href: '/docs/python/quick-start', label: 'Get started' }}
      secondaryCta={{ href: '/docs/python/datasets/multi-tenancy', label: 'Read the tenancy docs' }}
      language="python"
      stats={[
        { label: 'Isolation', value: 'Fail-closed tenant key' },
        { label: 'Tenant source', value: 'Authenticated principal only' },
        { label: 'Runs in', value: 'Jobs, FastAPI, agents' },
      ]}
      problems={[
        {
          title: 'One missing WHERE leaks a customer',
          copy: 'When every query has to remember `WHERE org_id = %s`, the one that forgets returns another customer’s data. Code review is the only guard.',
        },
        {
          title: 'The tenant ends up in the request body',
          copy: 'APIs that accept a tenant as a parameter let any caller ask for any tenant. The scope has to come from authentication, not input.',
        },
        {
          title: 'Each surface re-implements the rule',
          copy: 'Background jobs, API routes, and AI agents all need the same scoping, and each one is a new place to get it wrong.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Declare it once',
        title: 'The dataset owns the tenant rule',
        description:
          'Set `tenant_key` on the dataset and hypequery adds the tenant predicate to every query it plans. The tenant comes from a trusted execution context, never from the query itself.',
        bullets: [
          'A query without a tenant fails with `tenant-required`',
          'Filtering on the tenant field from a query is rejected',
          '`analytics.for_tenant(...)` binds a client to one tenant for a whole request',
          'The same rule applies to relationships and joined datasets',
        ],
        codePanel: {
          eyebrow: 'datasets.py',
          title: 'Tenant key on the dataset',
          description: 'Ordinary Python you review and version with the rest of your app.',
          code: datasetCode,
          filename: 'analytics/datasets.py',
        },
      }}
      implementationSection={{
        eyebrow: 'HTTP endpoints',
        title: 'Serve it with the tenant taken from auth',
        description:
          'hypequery Serve resolves the tenant from the authenticated principal. No header, query parameter, or body field can set or change it.',
        paragraphs: [
          'Mark an endpoint `tenant="required"` to refuse callers without a tenant, or `"forbidden"` for internal, tenant-free routes.',
          'A request body that tries to set a tenant is rejected with a validation error, so the scope can only narrow, never widen.',
        ],
        codePanel: {
          eyebrow: 'api.py',
          title: 'Tenant-scoped dataset endpoint',
          description: 'A resolver can return one tenant or none. It cannot grant several tenants or all of them.',
          code: serveCode,
          filename: 'analytics/api.py',
        },
      }}
      searchIntentCards={[
        {
          title: 'Row-level security for ClickHouse in Python',
          copy: 'hypequery enforces tenant scope in the query it generates. You can still add ClickHouse row policies underneath as a second layer.',
        },
        {
          title: 'Multi-tenant FastAPI analytics',
          copy: 'Dataset endpoints take the tenant from your authenticator, so every customer-facing chart is scoped the same way.',
        },
        {
          title: 'Tenant isolation for background jobs',
          copy: 'Jobs pass a trusted tenant through `ExecutionContext`. A job that forgets fails loudly instead of aggregating every customer.',
        },
        {
          title: 'Same rules for AI agents',
          copy: 'Agents connected over MCP run as one principal with one tenant, using the same datasets and the same scope.',
        },
      ]}
      readingLinks={[
        { href: '/docs/python/datasets/multi-tenancy', title: 'Dataset multi-tenancy', description: 'Tenant keys, execution context, and tenant-bound clients.' },
        { href: '/docs/python/multi-tenancy', title: 'Serve multi-tenancy', description: 'Resolve tenants from the principal and require them per endpoint.' },
        { href: '/docs/python/authentication', title: 'Authentication', description: 'Bearer tokens, API keys, and principals.' },
        { href: '/clickhouse-multi-tenant-analytics', title: 'Multi-tenant analytics in TypeScript', description: 'The same model on the TypeScript side.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-python-mcp', label: 'MCP for Python backends' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Add a tenant key to one dataset',
        description: 'Define one dataset with `tenant_key`, run a query without a tenant, and watch it refuse.',
        primaryCta: { href: '/docs/python/quick-start', label: 'Get started' },
        secondaryCta: { href: '/docs/python/datasets/multi-tenancy', label: 'Tenancy docs' },
      }}
    />
  );
}
