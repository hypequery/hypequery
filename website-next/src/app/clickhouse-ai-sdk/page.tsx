import type { Metadata } from 'next';
import { ClickhousePillarPage } from '@/components/clickhouse-pillar-page';
import { absoluteUrl, ogImage } from '@/lib/site';

export const metadata: Metadata = {
  title: 'ClickHouse + Vercel AI SDK: Analytics Chat Tools',
  description:
    'Give a Vercel AI SDK chat tenant-safe ClickHouse analytics: hypequery tools for streamText, with no text-to-SQL and no raw database access. Run them in your own backend or from hypequery Cloud.',
  alternates: {
    canonical: absoluteUrl('/clickhouse-ai-sdk'),
  },
  openGraph: {
    images: ogImage('ClickHouse Analytics Tools for the Vercel AI SDK'),
    type: 'website',
    url: absoluteUrl('/clickhouse-ai-sdk'),
    title: 'ClickHouse + Vercel AI SDK | hypequery',
    description:
      'AI SDK tools that query your ClickHouse datasets, scoped to the signed-in customer. No text-to-SQL.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ClickHouse + Vercel AI SDK | hypequery',
    description: 'Analytics chat on ClickHouse with the AI SDK: tenant-safe tools, no raw SQL.',
  },
};

const datasetCode = `// analytics/datasets.ts
import { dataset, dimension, measure } from '@hypequery/datasets';

export const Events = dataset('events', {
  source: 'events',
  description: 'Product events for the signed-in customer.',
  tenantKey: 'tenant_id',   // every query gets WHERE tenant_id = <session tenant>
  timeKey: 'occurred_at',
  dimensions: {
    eventType: dimension.string({ column: 'event_type', label: 'Event type' }),
    device: dimension.string({ label: 'Device' }),
  },
  measures: {
    events: measure.count('event_id', { label: 'Events' }),
    activeUsers: measure.countDistinct('user_id', { label: 'Active users' }),
  },
});`;

const routeCode = `// app/api/chat/route.ts
import { hypequeryTools } from '@hypequery/agent/ai-sdk';
import { createMCPExecutor } from '@hypequery/mcp';
import { convertToModelMessages, streamText } from 'ai';

export async function POST(request: Request) {
  const session = await getSession(request);           // your auth
  if (!session) return new Response('Sign in first.', { status: 401 });

  // The tenant comes from the server session, never the model.
  const executor = createMCPExecutor({ datasets, analytics, tenantId: session.tenantId });
  const tools = await hypequeryTools({ executor });

  const { messages } = await request.json();
  const result = streamText({
    model,
    tools,                                              // list_datasets, get_dataset_schema, query_dataset
    messages: await convertToModelMessages(messages),
  });
  return result.toUIMessageStreamResponse();
}`;

const cloudCode = `import { mintAgentToken } from '@hypequery/agent';
import { hypequeryTools } from '@hypequery/agent/ai-sdk';

// A 15-minute end-user token, signed locally with your project's key.
const { mcpUrl, token } = await mintAgentToken({
  signingKey: process.env.HYPEQUERY_AGENT_KEY!,
  tenant: session.tenantId,
  subject: session.userId,
  permissionSet: 'customers',
});

const tools = await hypequeryTools({ url: mcpUrl, token });`;

export default function ClickHouseAiSdkPage() {
  return (
    <ClickhousePillarPage
      leadPage="/clickhouse-ai-sdk"
      eyebrow="ClickHouse + AI SDK"
      title="Analytics chat on ClickHouse with the Vercel AI SDK"
      description="hypequery turns your ClickHouse datasets into AI SDK tools. Pass them to streamText and your chat answers questions about each customer's own data: no text-to-SQL, no database console for the model, and every query scoped to the signed-in tenant."
      primaryCta={{ href: '/examples/in-app-analytics-agent', label: 'Start from the Next.js starter' }}
      secondaryCta={{ href: '/docs/agents/quickstart', label: 'Read the docs' }}
      quickstart={{
        eyebrow: 'Quickstart',
        title: 'Add ClickHouse tools to an AI SDK chat',
        description:
          'Define what the model may query, create the tools per request with the tenant from your session, and pass them to streamText.',
        steps: [
          {
            title: 'Install the packages',
            description: 'Next.js, Express, Hono or any Node.js 20+ server.',
            code: `npm install ai @hypequery/agent @hypequery/mcp @hypequery/datasets @hypequery/clickhouse`,
            filename: 'terminal',
            language: 'bash',
          },
          {
            title: 'Define a dataset',
            description:
              'The dimensions and measures the model can ask for, with the descriptions it reads. tenantKey makes the dataset fail closed without a tenant.',
            code: datasetCode,
            filename: 'analytics/datasets.ts',
          },
          {
            title: 'Give the tools to streamText',
            description:
              'The executor runs in your route handler, against your ClickHouse. No MCP server to host and no token.',
            code: routeCode,
            filename: 'app/api/chat/route.ts',
          },
          {
            title: 'Ask a question',
            description:
              'The model lists datasets, reads the schema, and runs a validated query. The rows it gets back are this customer’s only.',
            code: `Which device had the most active users last week?`,
            filename: 'prompt',
            language: 'text',
          },
        ],
        footnote:
          'useChat from @ai-sdk/react renders the streamed answer and the tool calls. The starter wires up both, with two demo customers.',
      }}
      stats={[
        { label: 'Works with', value: 'streamText, generateText, useChat' },
        { label: 'The model writes', value: 'No SQL' },
        { label: 'Tenant from', value: 'Your server session' },
      ]}
      problems={[
        {
          title: 'Text-to-SQL is a guess you run against production',
          copy:
            'A model that writes ClickHouse SQL chooses tables, joins and filters at runtime. One wrong join or missing filter returns a plausible, wrong number.',
        },
        {
          title: 'A WHERE clause in the prompt is not tenant isolation',
          copy:
            'If the tenant lives in the prompt, a user can ask the model to change it. In a customer-facing chat, that is another customer’s data.',
        },
        {
          title: 'Hand-written tools drift from your metrics',
          copy:
            'A getRevenue tool per question means a second definition of revenue, maintained separately from your API and dashboards.',
        },
      ]}
      solutionSection={{
        eyebrow: 'One contract, every surface',
        title: 'The model queries datasets you define, not tables',
        description:
          'You declare dimensions and measures once. hypequery validates every query against them, compiles the SQL, and adds the tenant filter itself.',
        bullets: [
          'Three tools: list_datasets, get_dataset_schema, query_dataset, plus get_business_context when you publish one',
          'Input schemas generated from your datasets, so the model can only name real fields',
          'A filter on the tenant field is refused, and grouping by it returns only the signed-in customer',
          'Errors come back as structured envelopes with a hint, so the model corrects itself',
          'The same tools work with the Anthropic SDK and the OpenAI Agents SDK',
        ],
        codePanel: {
          eyebrow: '@hypequery/datasets',
          title: 'What the model is allowed to understand',
          description: 'Ordinary code, reviewed and versioned with your app. Labels and descriptions reach the model through get_dataset_schema.',
          code: datasetCode,
        },
      }}
      implementationSection={{
        eyebrow: 'Two ways to run it',
        title: 'In your own backend, or from hypequery Cloud',
        description:
          'Both give streamText the same tools, schemas and errors, so you can start in your backend and move later without touching your chat.',
        paragraphs: [
          'In your backend, hypequeryTools({ executor }) runs the tools in process against your ClickHouse connection. The tenant is the tenantId you pass from your session.',
          'With hypequery Cloud, your server mints a short-lived end-user token for the session and the tools call your project’s tenant endpoint. Cloud verifies the token, scopes every query to its tenant, and logs each request id so you can explain an answer later.',
        ],
        codePanel: {
          eyebrow: '@hypequery/agent',
          title: 'The Cloud variant',
          description: 'Minting is local: no network call. Pass a token function instead of a string to re-mint before it expires in a long chat.',
          code: cloudCode,
        },
      }}
      searchIntentCards={[
        {
          title: 'Vercel AI SDK ClickHouse',
          copy: 'Use hypequeryTools from @hypequery/agent/ai-sdk as the tools for streamText or generateText.',
        },
        {
          title: 'AI analytics chat in Next.js',
          copy: 'A route handler, useChat and two demo customers: the in-app analytics agent starter.',
        },
        {
          title: 'Multi-tenant AI chat',
          copy: 'The tenant comes from your server session or a signed token. The model has no way to choose it.',
        },
        {
          title: 'AI SDK and MCP',
          copy: 'The same tools are served over MCP to Claude, Cursor and other clients by @hypequery/mcp.',
        },
      ]}
      faq={[
        {
          question: 'Does the model write SQL?',
          answer:
            'No. The model calls query_dataset with dataset, dimension, measure and filter names from your schema. hypequery validates the request and compiles the ClickHouse SQL itself. The SQL is not shown to the model unless you enable it for debugging.',
        },
        {
          question: 'Do I need to host an MCP server?',
          answer:
            'No. hypequeryTools({ executor }) runs the tools inside your own route handler. If you use hypequery Cloud instead, the tools call your project’s hosted endpoint with a token your server mints.',
        },
        {
          question: 'How does tenant isolation work?',
          answer:
            'A dataset with a tenantKey refuses to run without a tenant. The tenant comes from your server session, every query gets the tenant filter, a filter on the tenant field is refused, and the tool schemas have no tenant argument for the model to set.',
        },
        {
          question: 'Which AI SDK versions are supported?',
          answer: '@hypequery/agent supports ai 5, 6 and 7 as an optional peer dependency.',
        },
        {
          question: 'Can I mix hypequery tools with my own tools?',
          answer: 'Yes. hypequeryTools returns a plain AI SDK tool set, so spread it into yours: { ...tools, ...yourTools }.',
        },
      ]}
      readingLinks={[
        {
          href: '/examples/in-app-analytics-agent',
          title: 'In-app analytics agent starter',
          description: 'Next.js App Router, AI SDK and useChat, with a tenant-isolation test against ClickHouse.',
        },
        {
          href: '/docs/agents/quickstart',
          title: 'Tools in your own backend',
          description: 'hypequeryTools({ executor }), tenant isolation and which tools the agent gets.',
        },
        {
          href: '/docs/agents/tools',
          title: 'Tools for your agent',
          description: 'The AI SDK, Anthropic and OpenAI Agents adapters with hypequery Cloud.',
        },
        {
          href: '/docs/agents/business-context',
          title: 'Business context',
          description: 'KPI definitions, glossary and caveats the model reads before it answers.',
        },
      ]}
      relatedPillars={[
        { href: '/clickhouse-ai-agents', label: 'ClickHouse AI agents' },
        { href: '/clickhouse-mcp', label: 'ClickHouse MCP server' },
        { href: '/clickhouse-nextjs', label: 'ClickHouse with Next.js' },
        { href: '/clickhouse-multi-tenant-analytics', label: 'Multi-tenant analytics' },
        { href: '/semantic-layer/ai-agents', label: 'Semantic layer for AI agents' },
      ]}
      nextStep={{
        eyebrow: 'Next step',
        title: 'Run the starter with two demo customers',
        description:
          'Clone the in-app analytics agent, point it at the seed ClickHouse, and ask it for the other customer’s numbers.',
        primaryCta: { href: '/examples/in-app-analytics-agent', label: 'Open the starter' },
        secondaryCta: { href: '/docs/agents/quickstart', label: 'Read the docs' },
      }}
    />
  );
}
