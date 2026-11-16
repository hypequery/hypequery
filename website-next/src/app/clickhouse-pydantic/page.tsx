import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

const TITLE = 'ClickHouse with Pydantic AI: Analytics Tools for Python Agents';
const DESCRIPTION =
  'Give a Pydantic AI agent typed ClickHouse analytics tools instead of a SQL console. Datasets are Pydantic models; the agent queries named measures, and the tenant comes from your API, never the prompt.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/clickhouse-pydantic') },
  openGraph: {
    images: ogImage(TITLE),
    type: 'website',
    url: absoluteUrl('/clickhouse-pydantic'),
    title: `${TITLE} | hypequery`,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', title: `${TITLE} | hypequery`, description: DESCRIPTION },
};

const datasetCode = `from hypequery.datasets import dataset, dimension, measure

orders = dataset(
    "orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "status": dimension.string(),
        "country": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
    },
)`;

const agentCode = `from fastapi import FastAPI, Request
from pydantic import BaseModel
from pydantic_ai import Agent

from hypequery.agent.pydantic_ai import hypequery_tools
from hypequery.mcp import ApiContractBackend, ClientContractExecutor

from app import api  # with add_client_contract_endpoint(api)

chat = FastAPI()


class Question(BaseModel):
    message: str


@chat.post("/chat")
async def answer(question: Question, request: Request) -> dict[str, str]:
    # Forward the signed-in user's credential: the API decides their tenant.
    executor = await ClientContractExecutor.create(
        ApiContractBackend(
            api, headers={"Authorization": request.headers["authorization"]}
        )
    )
    agent = Agent(
        "anthropic:claude-opus-5-5",
        tools=await hypequery_tools(executor=executor),
    )
    result = await agent.run(question.message)
    return {"answer": result.output}`;

const remoteCode = `pip install "hypequery[mcp]"

# chat.py
from hypequery.agent.pydantic_ai import hypequery_tools

tools = await hypequery_tools(
    url="https://mcp.example.com/mcp",  # http is allowed for localhost only
    token=lambda: get_user_token(session),  # asked for before every request
)`;

export default function ClickHousePydanticPage() {
  return (
    <ClickhousePillarPage
      eyebrow="Pydantic AI"
      title="Give your Pydantic AI agent ClickHouse analytics tools, not a SQL console"
      description="Define ClickHouse datasets as Pydantic models, then pass `hypequery_tools()` to a Pydantic AI `Agent`. The agent picks named measures and dimensions; hypequery validates the call, writes the SQL and applies the signed-in user's tenant."
      primaryCta={{ href: '/docs/agents/quickstart#python', label: 'Add AI chat to your app' }}
      secondaryCta={{ href: '/docs/agents/tools', label: 'See every tool' }}
      language="python"
      stats={[
        { label: 'Agent input', value: 'Measures and dimensions' },
        { label: 'SQL', value: 'Written by hypequery' },
        { label: 'Tenant', value: 'From your API auth' },
      ]}
      problems={[
        {
          title: 'A run_sql tool hands the model your database',
          copy: 'Giving a Pydantic AI agent a SQL tool, or a database MCP server, lets it choose tables, joins and result sizes. That works for an analyst exploring; it is not a permission system for customers.',
        },
        {
          title: 'The tenant filter lives in the prompt',
          copy: 'If the model has to remember `WHERE tenant_id = …`, a user can ask it to forget. The filter has to come from the server, where the model cannot change it.',
        },
        {
          title: 'The agent defines revenue a second time',
          copy: 'An agent that writes its own query gets a number that disagrees with your API and dashboards. The definition should be shared, not re-derived per question.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Datasets',
        title: 'ClickHouse datasets are Pydantic models',
        description:
          'A hypequery dataset names the table, the fields an agent may group and filter by, and the measures it may ask for. Datasets are immutable Pydantic models, validated when you create them, and importing `hypequery.datasets` needs only `pydantic`.',
        bullets: [
          'A wrong column type or a measure over an unknown field fails at import, not at the first question',
          '`tenant_key` makes the dataset fail closed: it will not run without a tenant, and every query is filtered to it',
          'The same definition serves your REST API, your React dashboard and the agent',
          'No database driver or web framework is loaded until you serve or query',
        ],
        codePanel: {
          eyebrow: 'datasets.py',
          title: 'One reviewed definition of each number',
          description: 'The agent can ask for `revenue` by `country`. It cannot redefine either.',
          code: datasetCode,
          filename: 'datasets.py',
        },
      }}
      implementationSection={{
        eyebrow: 'Pydantic AI',
        title: 'Pass the tools to your Agent',
        description:
          '`hypequery_tools()` returns a list of Pydantic AI `Tool` objects built from your API’s own contract. The executor runs your `hypequery.serve` API in process, as the user whose credential you forward.',
        paragraphs: [
          'The agent gets `list_datasets`, `get_dataset_schema` and `query_dataset`. Each tool’s JSON Schema comes from the dataset, so arguments are validated by hypequery against what the caller may query. A bad call returns an error with a code and a hint, so the model corrects itself instead of looping.',
          'Your API’s authentication resolves the tenant from the forwarded credential, exactly as it does over REST, and applies each endpoint’s policy, scopes and rate limits on every tool call. The agent can never query more than that user could.',
        ],
        codePanel: {
          eyebrow: 'chat.py',
          title: 'A FastAPI chat route with a Pydantic AI agent',
          description: 'Install with `pip install "hypequery[clickhouse]" "pydantic-ai-slim[anthropic]"`.',
          code: agentCode,
          filename: 'chat.py',
        },
      }}
      additionalSections={[
        {
          eyebrow: 'Over MCP',
          title: 'Or call a hypequery MCP endpoint',
          description:
            'When the tools should run in another service, point `hypequery_tools()` at its MCP URL instead of an executor. The agent sees the same tools, schemas and errors, so your chat code does not change.',
          paragraphs: [
            '`token` is a function, called before every request, so short-lived tokens refresh. With your API’s own auth on the server, each user’s token carries their own tenant.',
          ],
          codePanel: {
            eyebrow: 'chat.py',
            title: 'The same tools from a URL',
            description: 'Calling an MCP endpoint needs the `mcp` extra.',
            code: remoteCode,
            filename: 'chat.py',
          },
        },
      ]}
      searchIntentCards={[
        { title: 'Pydantic AI with ClickHouse', copy: 'Pass `hypequery_tools()` to `Agent(tools=…)`. The agent queries your datasets by name and never writes or sees SQL.' },
        { title: 'Pydantic models for ClickHouse', copy: 'Datasets, dimensions and measures are immutable Pydantic models, validated when they are created.' },
        { title: 'Multi-tenant Pydantic AI agents', copy: 'The tenant comes from the credential your API verifies. A filter on the tenant field is refused.' },
        { title: 'Text-to-SQL or typed tools', copy: 'Text-to-SQL lets the model choose the query. Typed tools let it choose from measures you defined and reviewed.' },
      ]}
      faq={[
        {
          question: 'Does hypequery work with Pydantic AI?',
          answer:
            'Yes. `hypequery.agent.pydantic_ai.hypequery_tools()` returns a list of Pydantic AI `Tool` objects you pass to `Agent(tools=…)`. It needs `pydantic-ai` or `pydantic-ai-slim` installed. The same tools are also available for the Anthropic SDK and the OpenAI Agents SDK.',
        },
        {
          question: 'Does the Pydantic AI agent write ClickHouse SQL?',
          answer:
            'No. The agent sends a dataset name with measures, dimensions and filters. hypequery validates that against the dataset, compiles the ClickHouse SQL and runs it. The model never writes or receives SQL.',
        },
        {
          question: 'Are hypequery datasets Pydantic models?',
          answer:
            'Yes. Datasets are immutable Pydantic models, validated when you create them. Importing `hypequery.datasets` needs only `pydantic`; no database driver or web framework is loaded.',
        },
        {
          question: 'How does the agent know which tenant to query?',
          answer:
            'It does not choose. You forward the signed-in user’s credential to the executor, and your API’s authentication resolves the tenant from it, as it does over REST. A dataset with `tenant_key` refuses to run without a tenant.',
        },
        {
          question: 'Can I use the ClickHouse MCP server with Pydantic AI instead?',
          answer:
            'Yes. Pydantic AI can connect to any MCP server, including ClickHouse’s own, which gives the model SQL access to the database. That suits internal exploration by people who can read SQL. For an agent that answers customers, hypequery gives the model named datasets and measures, with the tenant enforced by the server.',
        },
      ]}
      readingLinks={[
        { href: '/docs/agents/quickstart#python', title: 'Add AI chat to your app', description: 'The full quick start, with the Python tab for Pydantic AI.' },
        { href: '/docs/agents/tools', title: 'Tools for your agent', description: 'Every tool, its errors, and how to restrict which ones the agent gets.' },
        { href: '/docs/python/datasets/defining-datasets', title: 'Defining datasets in Python', description: 'Dimensions, measures, tenant keys and validation.' },
        { href: '/docs/quick-start/api-and-dashboard#python', title: 'Serve an API and a dashboard', description: 'The API the agent’s executor runs against.' },
        { href: '/docs/mcp/safety', title: 'MCP safety model', description: 'Credentials, limits, and tenant isolation.' },
      ]}
      relatedPillars={[
        { href: '/clickhouse-python', label: 'ClickHouse with Python' },
        { href: '/clickhouse-python-mcp', label: 'MCP for Python backends' },
        { href: '/clickhouse-fastapi', label: 'ClickHouse with FastAPI' },
        { href: '/clickhouse-python-multi-tenant', label: 'Python multi-tenancy' },
        { href: '/python-semantic-layer', label: 'Python semantic layer' },
        { href: '/semantic-layer/ai-agents', label: 'Semantic layer for AI agents' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Give one dataset to your Pydantic AI agent',
        description: 'Add the client contract route to your API, then pass `hypequery_tools(executor=executor)` to your agent.',
        primaryCta: { href: '/docs/agents/quickstart#python', label: 'Open the quick start' },
        secondaryCta: { href: '/docs/python/datasets/defining-datasets', label: 'Define a dataset' },
      }}
    />
  );
}
