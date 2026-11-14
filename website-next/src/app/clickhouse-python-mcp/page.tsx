import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse MCP Server for Python Backends';
const DESCRIPTION =
  'Give Claude, Cursor and other MCP clients your Python-defined ClickHouse datasets. Python keeps the SQL, auth and tenant; agents see only allowed endpoints.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-python-mcp') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-python-mcp'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const serveCode = `from hypequery.serve import (
    EndpointPolicy, add_client_contract_endpoint, add_dataset_endpoint,
    create_api,
)

policy = EndpointPolicy(
    tenant="required", required_scopes=frozenset({"analytics:read"})
)
api = create_api(auth=authenticate)

add_dataset_endpoint(
    api,
    "/v1/orders",
    dataset=orders,
    client=client,
    policy=policy,
    client_profile=profile,
)
# The authorized catalog hypequery mcp serves to agents
add_client_contract_endpoint(api, "/v1/client-contract", policy=policy)`;

const mcpCode = `pip install "hypequery[mcp]"

# The credential the server calls your API with: one principal, one tenant
export HYPEQUERY_API_KEY=…

# Check the setup without calling any query tool
hypequery mcp app:api --self-test

# Print the entry for Claude Desktop or Cursor
hypequery mcp app:api --print-config

# Or serve it at a URL for your team, behind a shared key.
# Keep the key: clients send it as "Authorization: Bearer <key>".
export HYPEQUERY_MCP_KEY=$(openssl rand -hex 32)
hypequery mcp app:api --http`;

export default function ClickHousePythonMcpPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-python-mcp"
      eyebrow="Python MCP"
      title="Give AI agents your Python ClickHouse datasets, not a SQL console"
      description="Define datasets in Python and run `hypequery mcp app:api`. Agents get exactly the endpoints the caller may call, so Claude and Cursor query governed measures while SQL, credentials, and the tenant stay in your Python process."
      primaryCta={{ href: '/docs/mcp/quickstart', label: 'Set up MCP for Python' }}
      secondaryCta={{ href: '/docs/mcp/safety', label: 'Read the safety model' }}
      language="python"
      stats={[
        { label: 'Agent surface', value: 'Authorized endpoints only' },
        { label: 'SQL and credentials', value: 'Stay in Python' },
        { label: 'Works with', value: 'Claude, Cursor, MCP clients' },
      ]}
      problems={[
        {
          title: 'A SQL tool hands the model your database',
          copy: 'Generic ClickHouse MCP servers let the agent pick tables, joins, and result sizes. A prompt is not a permission system.',
        },
        {
          title: 'Agents invent their own revenue',
          copy: 'When the agent writes its own query, its number disagrees with your dashboard. The definition has to be shared, not re-derived.',
        },
        {
          title: 'Python teams were left out',
          copy: 'Most semantic-layer MCP servers expect a Node or YAML project. Your analytics already live in a Python service.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Client contract',
        title: 'Publish what agents may call',
        description:
          'Install dataset endpoints with a client profile and add the client-contract route. The contract lists each endpoint’s fields, operators, and limits for the calling principal, and nothing else.',
        bullets: [
          'Agents see only endpoints the API key’s principal is allowed to call',
          'The tenant comes from that principal on the Python side; the agent cannot choose it',
          'Fields, filters, and limits are validated by Python before any SQL runs',
          'Every tool call runs through `Api.handle`, so auth, endpoint policy and rate limits apply exactly as they do over HTTP',
        ],
        codePanel: {
          eyebrow: 'api.py',
          title: 'Dataset endpoints plus live discovery',
          description: 'The same endpoints your React app calls. No separate agent backend.',
          code: serveCode,
          filename: 'analytics/api.py',
        },
      }}
      implementationSection={{
        eyebrow: 'MCP server',
        title: 'Run hypequery mcp on your API',
        description:
          'The Python CLI serves your API\'s authorized client contract to agents, over stdio or, with --http, at a URL. No Node process and no separate agent backend.',
        paragraphs: [
          '`app:api` is the `Api` from `create_api`. Each tool call goes through it in the same process, so authentication, endpoint policy, rate limits and tenant resolution are the ones an HTTP caller meets.',
          'API already deployed? `hypequery mcp --client-contract-url` bridges it over HTTPS instead, with the same tools. Agents get `list_datasets`, `get_dataset_schema`, and `query_dataset`, and never write or receive SQL.',
        ],
        codePanel: {
          eyebrow: 'terminal',
          title: 'Serve it to an agent',
          description: 'Paste the printed entry into Claude Desktop or Cursor, or connect a client to the --http URL.',
          code: mcpCode,
          filename: 'terminal',
          language: 'bash',
        },
      }}
      searchIntentCards={[
        { title: 'ClickHouse MCP server for Python', copy: 'Use your existing Python service as the MCP backend instead of exposing ClickHouse directly.' },
        { title: 'Semantic layer for AI agents in Python', copy: 'Agents query named measures and dimensions from your datasets, so their numbers match your product.' },
        { title: 'Multi-tenant MCP', copy: 'Over stdio the server acts as one principal and its tenant. Over HTTP with your app’s auth or OAuth, each caller’s tenant comes from their own credential.' },
        { title: 'Native Python MCP server', copy: 'Yes: `hypequery mcp app:api` runs in your Python process. Python keeps ownership of SQL, auth, and tenancy.' },
      ]}
      readingLinks={[
        { href: '/docs/mcp/quickstart', title: 'MCP quick start', description: 'Expose your first Python dataset to Claude or Cursor, then share it over HTTP.' },
        { href: '/docs/python/client-endpoints', title: 'React and MCP clients', description: 'Declare client endpoints and export the contract.' },
        { href: '/docs/mcp/overview', title: 'MCP overview', description: 'Every way to run the MCP server, and when to use each.' },
        { href: '/docs/mcp/tools', title: 'MCP tool catalog', description: 'Exactly what agents can discover and run.' },
        { href: '/docs/mcp/safety', title: 'MCP safety model', description: 'Credentials, limits, and tenant isolation.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse semantic layer' },
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Connect one dataset to your first agent',
        description: 'Add a client contract route to your API, then run `hypequery mcp app:api --self-test`.',
        primaryCta: { href: '/docs/mcp/quickstart', label: 'Open the MCP quickstart' },
        secondaryCta: { href: '/docs/mcp/clients', label: 'Configure a client' },
      }}
    />
  );
}
