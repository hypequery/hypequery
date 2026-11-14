import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse AI Agents and Agentic Analytics',
  description:
    'Build agentic analytics on ClickHouse: tenant-safe tools for the Vercel AI SDK, the Anthropic SDK and the OpenAI Agents SDK. Agents query your datasets and KPIs, never raw SQL.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-ai-agents'),
  },
  openGraph: {
    images: ogImage('Agentic Analytics on ClickHouse'),
    type: 'website',
    url: absoluteUrl('/clickhouse-ai-agents'),
    title: 'ClickHouse AI Agents and Agentic Analytics | hypequery',
    description:
      'One set of ClickHouse analytics tools for the AI SDK, the Anthropic SDK, the OpenAI Agents SDK and MCP clients.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse AI Agents | hypequery',
    description: 'Agentic analytics on ClickHouse without text-to-SQL.',
  },
};

const anthropicCode = `import Anthropic from '@anthropic-ai/sdk';
import { hypequeryTools } from '@hypequery/agent/anthropic';

const anthropic = new Anthropic();
const hq = await hypequeryTools({ executor });   // or { url, token } for hypequery Cloud

for (;;) {
  const response = await anthropic.messages.create({ model, max_tokens: 1024, tools: hq.tools, messages });
  messages.push({ role: 'assistant', content: response.content });
  if (response.stop_reason !== 'tool_use') break;
  messages.push({ role: 'user', content: await hq.toolResults(response.content) });
}`;

const openaiCode = `import { Agent, run } from '@openai/agents';
import { hypequeryTools } from '@hypequery/agent/openai-agents';

const agent = new Agent({
  name: 'Analyst',
  instructions: 'Answer questions about this customer’s usage with the hypequery tools.',
  tools: await hypequeryTools({ executor }),      // or { url, token } for hypequery Cloud
});
const result = await run(agent, 'Which features did we use most last month?');`;

const executorCode = `import { createMCPExecutor } from '@hypequery/mcp';

// Per request: bound to the tenant from your server session.
const executor = createMCPExecutor({
  datasets,              // what the agent may query
  analytics,             // createDatasetClient({ queryBuilder }) over your ClickHouse
  tenantId: session.tenantId,
  businessContext,       // KPI definitions, glossary, conventions, caveats
});`;

export default function ClickHouseAiAgentsPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-ai-agents"
      eyebrow="ClickHouse AI agents"
      title="Agentic analytics on ClickHouse, with the agent framework you already use"
      description="hypequery gives an AI agent governed ClickHouse analytics tools: it discovers your datasets, reads your KPI definitions and queries validated measures, scoped to one customer. The same tools plug into the Vercel AI SDK, the Anthropic SDK, the OpenAI Agents SDK and any MCP client."
      primaryCta={{ href: '/docs/agents/quickstart', label: 'Add tools to your agent' }}
      secondaryCta={{ href: '/examples/in-app-analytics-agent', label: 'See the starter' }}
      stats={[
        { label: 'Frameworks', value: 'AI SDK, Anthropic, OpenAI Agents, MCP' },
        { label: 'The agent writes', value: 'No SQL' },
        { label: 'Runs', value: 'Your backend or hypequery Cloud' },
      ]}
      comparisonMatrix={{
        eyebrow: 'Approaches',
        title: 'Three ways to give an agent ClickHouse',
        description: 'What the model controls, and what that means in a product your customers use.',
        columns: [
          { label: 'Text-to-SQL' },
          { label: 'Database MCP server' },
          { label: 'hypequery tools', highlight: true },
        ],
        rows: [
          { label: 'The model chooses', cells: ['The whole SQL query', 'Tables, columns and SQL', 'Datasets, measures and filters you defined'] },
          { label: 'Metric definitions', cells: ['Re-derived by the model each time', 'Re-derived by the model each time', 'Defined once in code, shared with your API'] },
          { label: 'Tenant isolation', cells: ['A WHERE clause the model must remember', 'A database user per tenant, if you set one up', 'Applied by hypequery from your session or a signed token'] },
          { label: 'Business meaning', cells: ['In the prompt', 'In the prompt', 'KPIs, glossary and caveats served with the tools'] },
          { label: 'Best for', cells: ['Analysts exploring a schema they know', 'Internal, trusted exploration', 'Agents in a product, answering customers'] },
        ],
        footnote:
          'Database MCP servers such as ClickHouse’s own are a good fit for internal exploration by people who can read SQL. hypequery is for agents whose answers customers act on.',
      }}
      problems={[
        {
          title: 'Agents need meaning, not just a schema',
          copy:
            'A table called events does not say that error rate means 5xx responses over all events, or that weeks start on Monday. Without that, the model guesses.',
        },
        {
          title: 'Every framework wants tools in its own shape',
          copy:
            'The AI SDK, the Anthropic SDK and the OpenAI Agents SDK each define tools differently. Writing them by hand three times means three places for a metric to drift.',
        },
        {
          title: 'Customer-facing agents need hard tenant boundaries',
          copy:
            'An instruction in the prompt is not access control. A prompt injection should have nothing to change.',
        },
      ]}
      solutionSection={{
        eyebrow: 'One tool surface',
        title: 'Define datasets and business context once, use them from any agent',
        description:
          'The executor turns your datasets into tools. @hypequery/agent hands them to each framework in its native shape, with the same schemas and the same error envelope.',
        bullets: [
          'list_datasets, with your business context attached, so the agent reads definitions first',
          'get_dataset_schema, with the labels and descriptions you wrote',
          'query_dataset, validated against the schema before any SQL runs',
          'get_business_context, the full glossary, KPIs and caveats',
          'Structured errors with a hint, so the agent corrects a bad query itself',
        ],
        codePanel: {
          eyebrow: '@hypequery/mcp',
          title: 'The executor behind every adapter',
          description: 'Created per request, so each agent run is bound to one customer.',
          code: executorCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Anthropic SDK',
        title: 'Claude tool use with ClickHouse',
        description:
          'hq.tools goes straight into messages.create, and hq.toolResults answers the model’s tool_use blocks. Tool errors come back as tool_result blocks with is_error, so Claude can retry.',
        codePanel: {
          eyebrow: '@hypequery/agent/anthropic',
          title: 'A Claude agent loop over ClickHouse',
          description: 'Mix in your own tools by passing them alongside hq.tools and answering their blocks yourself.',
          code: anthropicCode,
        },
      }}
      additionalSections={[
        {
          eyebrow: 'OpenAI Agents SDK',
          title: 'An OpenAI agent with ClickHouse tools',
          description:
            'hypequeryTools returns Agents SDK function tools with the server’s JSON Schemas, ready for new Agent({ tools }).',
          codePanel: {
            eyebrow: '@hypequery/agent/openai-agents',
            title: 'An analyst agent in a few lines',
            description: 'Errors are returned to the model as JSON with a code and a hint.',
            code: openaiCode,
          },
        },
        {
          eyebrow: 'Vercel AI SDK',
          title: 'Analytics chat with streamText and useChat',
          description:
            'The AI SDK adapter returns a tool set for streamText or generateText. The Next.js starter shows the whole chat, with two demo customers and a tenant-isolation test.',
          bullets: [
            'hypequeryTools({ executor }) in your route handler, or { url, token } with hypequery Cloud',
            'A token function re-mints before expiry in long conversations',
            'onResult records each request id to explain an answer later',
          ],
        },
      ]}
      searchIntentCards={[
        {
          title: 'Agentic analytics',
          copy: 'Agents that discover datasets, read KPI definitions and run validated queries on their own, inside your product.',
        },
        {
          title: 'ClickHouse AI agent',
          copy: 'Governed tools over your ClickHouse tables, for any agent framework or MCP client.',
        },
        {
          title: 'Claude and ClickHouse',
          copy: 'Anthropic SDK tool use with @hypequery/agent/anthropic, or Claude Desktop and Claude Code over MCP.',
        },
        {
          title: 'OpenAI Agents SDK and ClickHouse',
          copy: 'Function tools from @hypequery/agent/openai-agents, with the same tenant rules.',
        },
      ]}
      faq={[
        {
          question: 'What is agentic analytics?',
          answer:
            'Analytics where an AI agent decides which data to look at and runs the queries itself, rather than a person building a report. In a product, that means the agent needs approved datasets, clear metric definitions and a tenant it cannot change.',
        },
        {
          question: 'Is this text-to-SQL?',
          answer:
            'No. The agent sends dataset, measure, dimension and filter names. hypequery validates them against your schema and compiles the ClickHouse SQL, so the model never writes or sees SQL.',
        },
        {
          question: 'Which agent frameworks are supported?',
          answer:
            'The Vercel AI SDK, the Anthropic SDK and the OpenAI Agents SDK through @hypequery/agent, and any MCP client, such as Claude, Cursor or Codex, through @hypequery/mcp. All of them get the same tools and errors.',
        },
        {
          question: 'Do I need hypequery Cloud?',
          answer:
            'No. The tools run inside your own backend with hypequeryTools({ executor }). Cloud adds a hosted endpoint, signed end-user tokens, permission sets, release history for your datasets and business context, and request logs.',
        },
        {
          question: 'How does the agent know what our metrics mean?',
          answer:
            'Through business context: KPI definitions, a glossary, reporting conventions and data caveats you define with defineBusinessContext. The agent reads them from list_datasets before it queries.',
        },
      ]}
      readingLinks={[
        {
          href: '/docs/agents/quickstart',
          title: 'Tools in your own backend',
          description: 'hypequeryTools({ executor }) for the AI SDK, Anthropic and OpenAI Agents adapters.',
        },
        {
          href: '/docs/agents/business-context',
          title: 'Business context',
          description: 'Give agents your KPI definitions, glossary and caveats.',
        },
        {
          href: '/docs/agents/tools',
          title: 'Tools for your agent with hypequery Cloud',
          description: 'Tokens, sessions, request ids and the error envelope.',
        },
        {
          href: '/examples/in-app-analytics-agent',
          title: 'In-app analytics agent starter',
          description: 'A Next.js and AI SDK chat with two demo customers.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-ai-sdk', label: 'ClickHouse + Vercel AI SDK' },
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP server' },
        { href: '/semantic-layer/ai-agents', label: 'Semantic layer for AI agents' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-tenant analytics' },
        { href: '/embedded-analytics', label: 'Embedded analytics' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Give your agent one dataset',
        description: 'Define a dataset, create the executor with your session’s tenant, and pass the tools to your agent.',
        primaryCta: { href: '/docs/agents/quickstart', label: 'Read the guide' },
        secondaryCta: { href: '/clickhouse-ai-sdk', label: 'AI SDK quickstart' },
      }}
    />
  );
}
