import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse AI: Add AI Analytics Chat to Your App (Vercel AI SDK)',
  description:
    'Let users chat with their ClickHouse data inside your product. The model calls governed dataset tools from the Vercel AI SDK, Anthropic SDK or OpenAI Agents SDK, never raw SQL, and each customer only sees their own rows.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-ai'),
  },
  openGraph: {
    images: ogImage('AI Analytics Chat for ClickHouse'),
    type: 'website',
    url: absoluteUrl('/clickhouse-ai'),
    title: 'AI Analytics Chat for ClickHouse | hypequery',
    description:
      'Add a chat-with-your-data assistant on ClickHouse with the Vercel AI SDK. Governed tools, no raw SQL, tenant-safe.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI Analytics Chat for ClickHouse | hypequery',
    description: 'Governed ClickHouse tools for the Vercel AI SDK, Anthropic SDK and OpenAI Agents SDK.',
  },
};

const routeCode = `// app/api/chat/route.ts
import { anthropic } from '@ai-sdk/anthropic';
import { convertToModelMessages, isStepCount, streamText, type UIMessage } from 'ai';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // list_datasets, get_dataset_schema, query_dataset: no SQL tool.
  const tools = await hypequeryTools({
    url: process.env.HYPEQUERY_MCP_URL!,
    token: process.env.HYPEQUERY_MCP_KEY!,
  });

  const result = streamText({
    model: anthropic('claude-sonnet-5-5'),
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(8),
  });

  return result.toUIMessageStreamResponse();
}`;

const datasetCode = `// analytics/api.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  description: 'One row per order.',
  dimensions: {
    country: dimension.string({ label: 'Country' }),
    status: dimension.string({
      label: 'Status',
      description: 'completed, refunded or pending',
    }),
  },
  measures: {
    revenue: measure.sum('amount', { label: 'Revenue' }),
    orders: measure.count('id', { label: 'Orders' }),
  },
});`;

const anthropicCode = `import Anthropic from '@anthropic-ai/sdk';
import { hypequeryTools } from '@hypequery/agent/anthropic';

const anthropic = new Anthropic();
const hq = await hypequeryTools({ url: mcpUrl, token });
const response = await anthropic.messages.create({
  model, max_tokens: 1024, tools: hq.tools, messages,
});
messages.push({ role: 'assistant', content: response.content });
messages.push({ role: 'user', content: await hq.toolResults(response.content) });`;

const openaiCode = `import { Agent, run } from '@openai/agents';
import { hypequeryTools } from '@hypequery/agent/openai-agents';

const agent = new Agent({
  name: 'Analyst',
  tools: await hypequeryTools({ url: mcpUrl, token }),
});
const result = await run(agent, 'Which countries grew fastest last quarter?');`;

export default function ClickHouseAiPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-ai"
      eyebrow="ClickHouse AI"
      title="AI analytics chat for ClickHouse, with tools your model can't misuse"
      description="Add a chat-with-your-data assistant to your product. @hypequery/agent gives the Vercel AI SDK, the Anthropic SDK or the OpenAI Agents SDK typed tools over your ClickHouse datasets. The model asks for named measures and dimensions, never writes SQL, and only ever sees the signed-in customer's rows."
      primaryCta={{ href: '/blog/clickhouse-ai-chat-vercel-ai-sdk', label: 'Build the chat app' }}
      secondaryCta={{ href: '/docs/agents/ai-sdk', label: 'AI SDK docs' }}
      quickstart={{
        eyebrow: 'Quickstart',
        title: 'A ClickHouse chat in a Next.js route',
        description:
          'Define what the model may query, serve it as MCP tools, and hand those tools to streamText. useChat on the client needs nothing hypequery-specific.',
        steps: [
          {
            title: 'Install the packages',
            description: 'In a Next.js app. You need Node.js 20 or newer.',
            code: `npm install ai @ai-sdk/react @ai-sdk/anthropic @hypequery/agent
npm install @hypequery/clickhouse @hypequery/datasets @hypequery/serve @hypequery/mcp
npm install -D @hypequery/cli`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Define what the model may query',
            description:
              'Save a dataset in analytics/api.ts and register it with Serve, as in the MCP quickstart. Labels and descriptions are what the model reads to pick fields.',
            code: datasetCode,
            filename: 'analytics/api.ts',
          },
          {
            title: 'Serve it as MCP tools',
            description:
              'The endpoint holds the ClickHouse connection; your app only holds the key. The dataset is tenant-scoped, so a shared key serves one trusted tenant, named with --tenant. In production, serve it with your API\'s own auth instead, so each caller gets their own tenant.',
            code: `export HYPEQUERY_MCP_KEY=$(openssl rand -hex 32)
npx hypequery mcp --http --tenant acme
# hypequery MCP listening on http://127.0.0.1:3333/mcp`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Give the tools to the AI SDK',
            description:
              'hypequeryTools() lists the endpoint\'s tools once and returns an AI SDK tool set, with the server\'s schemas unchanged.',
            code: routeCode,
            filename: 'app/api/chat/route.ts',
          },
        ],
        footnote:
          'On AI SDK 5 or 6, use `system` and `stepCountIs` instead of `instructions` and `isStepCount`. The full walkthrough, with the chat component, is in the Vercel AI SDK tutorial.',
      }}
      stats={[
        { label: 'Works with', value: 'AI SDK, Anthropic, OpenAI Agents' },
        { label: 'Model surface', value: 'Datasets, not SQL' },
        { label: 'Tenant', value: 'From the token, never the prompt' },
      ]}
      problemsHeading={{
        eyebrow: 'Why text-to-SQL breaks',
        title: 'Letting the model write SQL against ClickHouse goes wrong in specific ways',
      }}
      problems={[
        {
          title: 'ClickHouse semantics are easy to get wrong',
          copy:
            'A ReplacingMergeTree read without FINAL counts rows twice, uniq and uniqExact disagree, and UTC DateTime columns shift day boundaries. Generated SQL gets these wrong quietly.',
        },
        {
          title: 'The chat disagrees with your dashboards',
          copy:
            'If the model writes its own revenue query on every question, its number drifts from the one in your product and your finance reports.',
        },
        {
          title: 'A prompt is not a tenant boundary',
          copy:
            'Nothing in a generated SQL string stops a read of another customer\'s rows. In a multi-tenant product, the tenant has to come from your auth, not from the model.',
        },
      ]}
      solutionSection={{
        eyebrow: 'Governed tools',
        title: 'Give the model a semantic layer instead of a SQL console',
        description:
          'You define datasets once in TypeScript or Python. The model discovers them, reads their schemas and queries them through three small tools, and every query is validated before it reaches ClickHouse.',
        bullets: [
          'The model can only ask for dimensions, measures and filters your datasets declare',
          'A wrong field comes back as a correctable error listing the valid ones, so the model retries',
          'Measures mean the same thing in the chat, your APIs and your React dashboards',
          'SQL and ClickHouse credentials never enter the model context',
          'Tenant-scoped datasets refuse to run without a trusted tenant',
        ],
        codePanel: {
          eyebrow: 'Vercel AI SDK',
          title: 'streamText with hypequery tools',
          description:
            'Any AI SDK provider works. Tool calls stream to useChat as message parts, so users can open an answer and see the exact query behind it.',
          code: routeCode,
          filename: 'app/api/chat/route.ts',
        },
      }}
      implementationSection={{
        eyebrow: 'Any agent SDK',
        title: 'The same tools for the Anthropic SDK and the OpenAI Agents SDK',
        description:
          '@hypequery/agent reads the tools your MCP endpoint serves and adapts them to the SDK you already use. You don\'t need an MCP client, and you don\'t write any tools.',
        paragraphs: [
          'Each adapter keeps the input schemas the server lists, so the model sees enums of your real field names. Tool errors reach the model as hypequery\'s error envelope, with a code, a hint and a request id.',
          'Failures the model can\'t fix, like a refused token or an unreachable endpoint, throw HypequeryToolsError in your code instead.',
        ],
        codePanel: {
          eyebrow: 'Anthropic SDK',
          title: 'Tool definitions and tool_result helpers',
          description: 'hq.toolResults() answers the model\'s tool_use blocks for hypequery\'s tools.',
          code: anthropicCode,
          filename: 'agent.ts',
        },
        codePanels: [
          {
            eyebrow: 'OpenAI Agents SDK',
            title: 'Function tools for an Agent',
            description: 'Pass them straight to new Agent({ tools }).',
            code: openaiCode,
            filename: 'agent.ts',
          },
        ],
      }}
      additionalSections={[
        {
          eyebrow: 'Multi-tenant',
          title: 'One customer per conversation',
          description:
            'The token decides whose data the model sees. Your route reads it from the signed-in user, so a prompt asking for another customer\'s data has nothing to change.',
          bullets: [
            'Self-hosted: run hypequery mcp --http with your API\'s own auth, and pass the user\'s credential as the token',
            'hypequery Cloud (not live yet): mint a 15-minute token per session with mintAgentToken(), locally, with no network call',
            'Every tool result carries a request id, so you can trace an answer back to its query',
          ],
        },
      ]}
      searchIntentCards={[
        {
          title: 'Chat with ClickHouse data',
          copy:
            'Put a natural-language analytics assistant in your product without giving the model database access.',
        },
        {
          title: 'Vercel AI SDK and ClickHouse',
          copy: 'hypequeryTools() returns AI SDK tools for streamText, generateText and useChat, on ai 5, 6 and 7.',
        },
        {
          title: 'Text-to-SQL alternative',
          copy:
            'Named measures and dimensions instead of generated SQL, so answers match your dashboards and can be checked.',
        },
        {
          title: 'AI analytics for multi-tenant SaaS',
          copy: 'The tenant comes from a signed token or your app\'s auth, never from the conversation.',
        },
      ]}
      faq={[
        {
          question: 'Can I use OpenAI, Gemini or a local model instead of Claude?',
          answer:
            'Yes. hypequeryTools() returns standard AI SDK tools, so any AI SDK provider with tool calling works. There are also adapters for the Anthropic SDK and the OpenAI Agents SDK.',
        },
        {
          question: 'Does the model ever see SQL or my ClickHouse credentials?',
          answer:
            'No. The credentials stay in the MCP endpoint, and generated SQL is redacted from tool results by default.',
        },
        {
          question: 'Do I need hypequery Cloud?',
          answer:
            'No. Run the MCP endpoint yourself with npx hypequery mcp --http and point hypequeryTools() at it. hypequery Cloud, which is not live yet, will host the endpoint and mint per-tenant tokens for you.',
        },
        {
          question: 'Which AI SDK versions are supported?',
          answer: 'ai 5, 6 and 7. @hypequery/agent declares them as optional peer dependencies.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/query-building/setup',
          title: 'The typed query builder underneath',
          description: 'Datasets are built on hypequery\'s ClickHouse query builder. Use it directly for the one-off queries in your app code.',
        },
        {
          href: '/blog/clickhouse-ai-chat-vercel-ai-sdk',
          title: 'Build an AI analytics chat with the Vercel AI SDK',
          description: 'The full Next.js walkthrough: dataset, MCP endpoint, route handler and useChat component.',
        },
        {
          href: '/docs/agents/ai-sdk',
          title: 'Vercel AI SDK docs',
          description: 'streamText, generateText, useChat and every hypequeryTools() option.',
        },
        {
          href: '/docs/agents/tools',
          title: 'Tools for your agent',
          description: 'The Anthropic SDK and OpenAI Agents SDK adapters.',
        },
        {
          href: '/blog/ai-agent-multi-tenant-data-isolation',
          title: 'Stop an AI agent leaking data between tenants',
          description: 'Row policies, scoped tools and scoped tokens, with tests you can run.',
        },
        {
          href: '/blog/text-to-sql-vs-semantic-layer',
          title: 'Text-to-SQL vs a semantic layer',
          description: 'Where NL2SQL agents go wrong, where they are the right tool, and how to combine them.',
        },
        {
          href: '/compare/hypequery-vs-clickhouse-agents',
          title: 'hypequery vs ClickHouse Agents',
          description: 'An agent for your team, or an agent in your product.',
        },
        {
          href: '/semantic-layer/ai-agents',
          title: 'Semantic layer for AI agents',
          description: 'Why agents need named metrics instead of raw text-to-SQL, and how the options compare.',
        },
        {
          href: '/blog/clickhouse-mcp-servers-compared',
          title: 'Official ClickHouse MCP vs governed MCP',
          description: 'When a raw SQL tool is fine, and when it becomes a problem.',
        },
        {
          href: '/docs/mcp/safety',
          title: 'MCP safety model',
          description: 'Credentials, SQL visibility, limits and tenant isolation.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP' },
        { href: '/clickhouse-semantic-layer', label: 'ClickHouse Semantic Layer' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse Next.js' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-Tenant Analytics' },
        { href: '/clickhouse-saas-analytics', label: 'Embedded Analytics for SaaS' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Ship a ClickHouse chat in an afternoon',
        description:
          'Follow the tutorial with the public ClickHouse playground, then point the dataset at your own tables.',
        primaryCta: { href: '/blog/clickhouse-ai-chat-vercel-ai-sdk', label: 'Open the tutorial' },
        secondaryCta: { href: '/docs/mcp/quickstart', label: 'MCP quickstart' },
      }}
    />
  );
}
