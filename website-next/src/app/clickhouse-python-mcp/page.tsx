import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse MCP Server for Python Backends';
const DESCRIPTION =
  'Give Claude, Cursor, and other MCP clients your Python-defined ClickHouse datasets. Python keeps the SQL, auth, and tenant; agents only see the endpoints they are allowed to call.';

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
    EndpointPolicy,
    add_client_contract_endpoint,
    add_dataset_endpoint,
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
# The authorized catalog the MCP bridge reads
add_client_contract_endpoint(api, "/v1/client-contract", policy=policy)`;

const bridgeCode = `npm install @hypequery/mcp
npm install -D @hypequery/cli

# One bridge process acts as one principal: one API key, one tenant
HYPEQUERY_API_KEY=… npx hypequery mcp \\
  --client-contract-url https://analytics.example.com/v1/client-contract

# Check the setup without calling any query tool
npx hypequery mcp --client-contract-url … --self-test`;

export default function ClickHousePythonMcpPage() {
  return (
    <ClickhousePillarPage
      eyebrow="Python MCP"
      title="Give AI agents your Python ClickHouse datasets, not a SQL console"
      description="Define datasets in Python and serve them with FastAPI. The hypequery MCP bridge exposes exactly the endpoints an API key may call, so Claude and Cursor query governed measures while SQL, credentials, and the tenant stay in your backend."
      primaryCta={{ href: '/docs/python/client-endpoints', label: 'Set up MCP for Python' }}
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
          'If definitions change while the bridge runs, tools fail with `MCP_STALE_CONTRACT` until restart',
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
        eyebrow: 'MCP bridge',
        title: 'Point the bridge at your Python API',
        description:
          'The hypequery CLI runs the MCP server over stdio and turns each tool call into the same HTTP request a generated React client sends. Python needs no Node process; only the bridge does.',
        paragraphs: [
          'The contract URL must be HTTPS (or plain HTTP on localhost), and the API key is sent only to that origin. Redirects are refused.',
          'Agents get `list_datasets`, `get_dataset_schema`, and `query_dataset` tools. They never write or receive SQL.',
        ],
        codePanel: {
          eyebrow: 'terminal',
          title: 'Start the bridge',
          description: 'Add the same command to Claude Desktop or Cursor’s MCP config.',
          code: bridgeCode,
          filename: 'terminal',
          language: 'bash',
        },
      }}
      searchIntentCards={[
        { title: 'ClickHouse MCP server for Python', copy: 'Use your existing Python service as the MCP backend instead of exposing ClickHouse directly.' },
        { title: 'Semantic layer for AI agents in Python', copy: 'Agents query named measures and dimensions from your datasets, so their numbers match your product.' },
        { title: 'Multi-tenant MCP', copy: 'Run one bridge per principal. Each one is scoped to that principal’s tenant by your Python auth.' },
        { title: 'Native Python MCP server?', copy: 'Not today. The Node bridge reads your live contract; Python keeps ownership of SQL, auth, and tenancy.' },
      ]}
      readingLinks={[
        { href: '/docs/python/client-endpoints', title: 'React and MCP clients', description: 'Declare client endpoints, export the contract, connect MCP.' },
        { href: '/docs/mcp/overview', title: 'MCP overview', description: 'How the MCP server and bridge fit together.' },
        { href: '/docs/mcp/tools', title: 'MCP tool catalog', description: 'Exactly what agents can discover and run.' },
        { href: '/docs/mcp/safety', title: 'MCP safety model', description: 'Credentials, limits, and tenant isolation.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Connect one dataset to your first agent',
        description: 'Add a client contract route to your FastAPI app, then run the bridge with `--self-test`.',
        primaryCta: { href: '/docs/python/client-endpoints', label: 'Set up MCP for Python' },
        secondaryCta: { href: '/docs/mcp/clients', label: 'Configure a client' },
      }}
    />
  );
}
