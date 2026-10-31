import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'FastAPI and React Analytics with Typed Hooks';
const DESCRIPTION =
  'Define ClickHouse datasets in Python, serve them from FastAPI, and get typed React hooks generated from the same definitions. No hand-written fetch code or duplicated types.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/fastapi-react-analytics') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/fastapi-react-analytics'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const definitionsCode = `# analytics/definitions.py — no FastAPI, driver, or credentials imported
from hypequery.datasets import (
    ClientEndpointDefinition,
    ClientQueryProfile,
    dataset,
    dimension,
    export_client_contract,
    measure,
)

orders = dataset(
    "orders",
    source="orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={
        "status": dimension.string(),
        "country": dimension.string(),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("order_id"),
    },
)
profile = ClientQueryProfile(default_limit=50, max_limit=500)


def build():
    """Factory for \`python -m hypequery export client-contract\`."""
    return export_client_contract(
        [ClientEndpointDefinition(orders, "/v1/orders", profile)]
    )`;

const reactCode = `# 1. Export the contract from Python (add --check in CI)
python -m hypequery export client-contract \\
  --factory analytics.definitions:build \\
  --output web/client-contract.json

# 2. Generate a typed React client in the frontend
npx hypequery generate:client client-contract.json \\
  --output src/hypequery-client.ts

# 3. Use it in a component
#   const { data } = useDataset('orders', {
#     dimensions: ['country'],
#     measures: ['revenue'],
#   });`;

export default function FastApiReactAnalyticsPage() {
  return (
    <ClickhousePillarPage
      eyebrow="FastAPI + React"
      title="FastAPI analytics with typed React hooks, generated from Python"
      description="Keep your analytics in Python, where your data team already works. hypequery serves the datasets from FastAPI and generates a typed React client from the same definitions, so the frontend can only ask for fields that exist."
      primaryCta={{ href: '/docs/python/client-endpoints', label: 'Get started' }}
      secondaryCta={{ href: '/docs/react/getting-started#datasets-served-from-python', label: 'React setup' }}
      language="python"
      stats={[
        { label: 'Backend', value: 'Python + FastAPI' },
        { label: 'Frontend', value: '@hypequery/react hooks' },
        { label: 'Contract', value: 'Exported, checked in CI' },
      ]}
      problems={[
        {
          title: 'Types drift across the language boundary',
          copy: 'A Pydantic model in Python and a hand-written TypeScript interface in React agree until someone renames a field.',
        },
        {
          title: 'Every chart needs fetch glue',
          copy: 'Each panel gets its own request helper, loading state, and response type, written by hand against an API it cannot see.',
        },
        {
          title: 'The frontend can ask for anything',
          copy: 'Without a contract, the browser can request fields, filters, and page sizes the backend never meant to allow.',
        },
      ]}
      solutionSection={{
        eyebrow: 'One contract',
        title: 'Python defines it. React is generated from it.',
        description:
          'Declare which endpoints clients may call in a definitions module with no side effects. Export a client contract from it, without starting a server or opening a connection.',
        bullets: [
          'Only declared endpoints, dimensions, measures, and order fields type-check',
          'There is no tenant input at all; the tenant comes from Python auth',
          'Measure values arrive as strings, so decimals keep their precision',
          '`--check` in CI fails when definitions change but the committed contract did not',
        ],
        codePanel: {
          eyebrow: 'definitions.py',
          title: 'Endpoints clients may call',
          description: 'Install the same endpoints in FastAPI with `client_profile=` at the same path.',
          code: definitionsCode,
          filename: 'analytics/definitions.py',
        },
      }}
      implementationSection={{
        eyebrow: 'Generate the client',
        title: 'Export, generate, and query from React',
        description:
          'The Node CLI turns the exported contract into a typed client for `@hypequery/react`. Python needs no Node process at runtime.',
        paragraphs: [
          'Generated requests carry a schema hash. If the live endpoint no longer matches the contract, the server answers `409 CLIENT_SCHEMA_CHANGED` instead of returning the wrong shape.',
          'The same live contract powers the MCP bridge, so React and AI agents call the same endpoints.',
        ],
        codePanel: {
          eyebrow: 'terminal',
          title: 'From Python definitions to a React hook',
          description: 'Re-run the export whenever definitions change, and commit the contract.',
          code: reactCode,
          filename: 'terminal',
          language: 'bash',
        },
      }}
      searchIntentCards={[
        { title: 'FastAPI React dashboard', copy: 'Typed hooks over FastAPI dataset endpoints, with caching and loading state from TanStack Query.' },
        { title: 'Share types between Python and TypeScript', copy: 'The client contract is the shared schema. Generate it, commit it, and check it in CI.' },
        { title: 'ClickHouse dashboard with a Python backend', copy: 'Keep SQL, auth, and tenancy in Python; let the frontend select dimensions and measures by name.' },
        { title: 'Embedded customer analytics', copy: 'Every hook call runs as the signed-in customer, because the tenant is resolved by your FastAPI authenticator.' },
      ]}
      readingLinks={[
        { href: '/docs/python/client-endpoints', title: 'React and MCP clients', description: 'Declare endpoints, install them, export the contract.' },
        { href: '/docs/react/getting-started', title: 'React getting started', description: 'Provider setup and the generated hooks.' },
        { href: '/docs/python/fastapi', title: 'FastAPI', description: 'Mount hypequery in a FastAPI app.' },
        { href: '/docs/python/cli', title: 'Python CLI', description: '`export client-contract`, `--check`, and `--force`.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-react', label: 'ClickHouse React' },
        { href: '/clickhouse-python-mcp', label: 'MCP for Python backends' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Generate your first typed hook from Python',
        description: 'Declare one client endpoint, export the contract, and call `useDataset` from a component.',
        primaryCta: { href: '/docs/python/client-endpoints', label: 'Get started' },
        secondaryCta: { href: '/docs/react/getting-started', label: 'React docs' },
      }}
    />
  );
}
