import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse with FastAPI: Secure Analytics APIs in Python',
  description:
    'Serve ClickHouse analytics from FastAPI with authenticated, tenant-scoped endpoints, strict request validation, rate limiting, and a production profile.',
  alternates: { canonical: absoluteUrl('/clickhouse-fastapi') },
  openGraph: {
    images: ogImage('ClickHouse with FastAPI: Secure Analytics APIs in Python'),
    type: 'website',
    url: absoluteUrl('/clickhouse-fastapi'),
    title: 'ClickHouse with FastAPI: Secure Analytics APIs in Python | hypequery',
    description:
      'Turn ClickHouse datasets into authenticated FastAPI endpoints with tenant isolation, validation, and rate limiting built in.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse with FastAPI: Secure Analytics APIs in Python | hypequery',
    description:
      'Turn ClickHouse datasets into authenticated FastAPI endpoints with tenant isolation, validation, and rate limiting built in.',
  },
};

const routerCode = `from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    create_app,
    create_router,
)


async def authenticate(credential: Credential) -> Principal | None:
    claims = await verify_jwt(credential.value)  # your token verification
    if claims is None:
        return None
    return Principal(
        subject=claims["sub"],
        scopes=frozenset(claims.get("scope", "").split()),
        tenant_id=claims.get("org_id"),
    )


router = create_router(authenticate=authenticate)
add_dataset_endpoint(
    router,
    "/datasets/orders/query",
    dataset=orders,
    client=analytics,
    policy=EndpointPolicy(required_scopes=frozenset({"analytics:read"}), tenant="required"),
)

app = create_app(router, security=HttpSecurity(allowed_hosts=("analytics.example.com",)))`;

const requestCode = `curl -X POST https://analytics.example.com/datasets/orders/query \\
  -H "Authorization: Bearer $TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"dimensions": ["country"], "measures": ["revenue"], "limit": 10}'

# {"data": [{"country": "NZ", "revenue": "1200.5"}]}

# Without a token:
# 401 {"error": {"type": "UNAUTHORIZED", "message": "Access denied", ...}}`;

export default function ClickHouseFastAPIPage() {
  return (
    <ClickhousePillarPage
      eyebrow="ClickHouse FastAPI"
      title="Serve ClickHouse analytics from FastAPI without hand-writing every endpoint"
      description="Most FastAPI analytics endpoints are the same code repeated: parse filters, build SQL, add the tenant, check permissions, shape errors. hypequery serves your ClickHouse datasets as authenticated, tenant-scoped endpoints, so the route stops being where the analytics logic lives."
      primaryCta={{ href: '/docs/python/fastapi', label: 'Read the FastAPI guide' }}
      secondaryCta={{ href: '/clickhouse-python', label: 'ClickHouse with Python' }}
      stats={[
        { label: 'Framework', value: 'FastAPI router' },
        { label: 'Auth', value: 'Bearer tokens or API keys' },
        { label: 'Default', value: 'Authenticated, docs closed' },
      ]}
      problems={[
        {
          title: 'Every endpoint rebuilds the same plumbing',
          copy:
            'Filter parsing, SQL building, pagination, and error shapes get reimplemented per route, and each one handles the edge cases slightly differently.',
        },
        {
          title: 'Tenant scoping lives in handler code',
          copy:
            'If each handler adds its own tenant filter, one missed handler exposes another customer’s data. The safe default should not depend on every developer remembering it.',
        },
        {
          title: 'Request bodies become an attack surface',
          copy:
            'Flexible analytics endpoints invite callers to send SQL fragments, extra fields, or a different tenant id. Validation has to be strict, and it is easy to get wrong.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Serve',
        title: 'Register a dataset as an endpoint on an authenticated router',
        description:
          'Every route on the router requires authentication unless you mark it public, and authentication runs before the body is read. The tenant always comes from the authenticated principal.',
        bullets: [
          'Bearer token or API key credentials, verified by your own authenticator',
          'Per-endpoint roles, scopes, and tenant requirements',
          'Strict JSON bodies: unknown fields, coercion, and tenant or SQL injection attempts are refused',
          'Pagination, result metadata, and an authenticated discovery catalog',
          'Rate limiting, allowed hosts, CORS, trusted proxies, and request ids',
        ],
        codePanel: {
          eyebrow: 'Router',
          title: 'A tenant-scoped dataset endpoint',
          description: '`orders` and `analytics` are the dataset and client from your Python model.',
          code: routerCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Call it',
        title: 'One request shape for every dataset',
        description:
          'Callers post dimensions, measures, filters, ordering, a time grain, and pagination. Errors use one envelope with stable types, so clients handle them the same way everywhere.',
        paragraphs: [
          'The request and response shapes match the TypeScript Serve runtime, and shared HTTP fixtures run against both implementations in CI. HTTP clients written against one work against the other.',
          'For a standalone service, the production profile runs one hardened Uvicorn worker with concurrency, timeout, row, and byte limits, and rejects debug settings at startup.',
        ],
        codePanel: {
          eyebrow: 'Request',
          title: 'Query the endpoint over HTTP',
          description: 'Measure values are strings on the wire, matching TypeScript.',
          code: requestCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Who this is for',
          copy:
            'Teams exposing ClickHouse analytics from a Python backend, especially to customers in a multi-tenant product.',
        },
        {
          title: 'Fits your existing app',
          copy:
            'The router is a FastAPI router. Add your own routes next to the generated ones and use the authenticated principal in them.',
        },
        {
          title: 'Security defaults',
          copy:
            'Docs and OpenAPI are closed unless you enable them for development, and authenticated responses are never cached.',
        },
        {
          title: 'Where to go next',
          copy:
            'Start with the Python datasets docs if you have not modelled a table yet, then come back to serving.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/python/fastapi',
          title: 'Python Serve docs',
          description: 'Getting started, dataset endpoints, authentication, and multi-tenancy.',
        },
        {
          href: '/docs/python/production',
          title: 'Production profile',
          description: 'Run the service with validated process, timeout, and result limits.',
        },
        {
          href: '/clickhouse-python',
          title: 'ClickHouse with Python',
          description: 'Model ClickHouse tables as datasets and query them by name.',
        },
        {
          href: '/clickhouse-rest-api',
          title: 'ClickHouse REST API',
          description: 'The same served API pattern in TypeScript.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse Python' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-tenant analytics' },
        { href: '/clickhouse-rest-api', label: 'ClickHouse REST API' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Serve one dataset behind your existing auth',
        description:
          'Wire your token verification into the authenticator, register one dataset endpoint, and point a dashboard or customer integration at it.',
        primaryCta: { href: '/docs/python/fastapi', label: 'Read the FastAPI guide' },
        secondaryCta: { href: '/docs/python/authentication', label: 'Authentication docs' },
      }}
    />
  );
}
