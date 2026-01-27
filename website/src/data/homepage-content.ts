export const heroCode = `
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './analytics/client';

const serve = initServe({
  context: () => ({ db }),
});
const { query } = serve;

export const api = serve.define({
  queries: serve.queries({
    weeklyRevenue: query
      .input(z.object({ startDate: z.string() }))
      .query(async ({ ctx, input }) =>
        ctx.db
          .table('orders')
          .where('created_at', 'gte', input.startDate)
          .groupBy(['week'])
          .sum('total', 'revenue')
          .execute()
      ),
  }),
});
`;

export const runAnywhereSnippets = {
  embedded: {
    code: "const revenue = await api.execute('weeklyRevenue');",
    language: 'typescript',
  },
  api: {
    code: 'POST /api/weeklyRevenue',
    language: 'http',
  },
  react: {
    code: "const { data } = useQuery('weeklyRevenue');",
    language: 'typescript',
  },
  agent: {
    code: '{ "tool": "weeklyRevenue", "arguments": {} }',
    language: 'json',
  },
};

export interface UseCaseExample {
  id: string;
  title: string;
  summary: string;
  body: string;
  codeLanguage: string;
  code: string;
}

export const useCaseExamples: UseCaseExample[] = [
  {
    id: 'backend',
    title: 'Backend & platform',
    summary:
      'Stop copying SQL between services. Define analytics once and reuse them across jobs, APIs, and internal tools.',
    body: 'Backend and platform engineers pull the same hypequery definition into cron jobs, queues, and HTTP handlers so every service agrees on revenue math.',
    codeLanguage: 'typescript',
    code: `
// jobs/renewal-digest.ts
import { api } from '../analytics/api';
import { notifyOps } from '../lib/notifications';

export async function sendRenewalDigest() {
  const digest = await api.run('renewalHealth', {
    windowEnd: new Date().toISOString(),
  });

  await notifyOps('renewals', digest.rows);
}
`,
  },
  {
    id: 'saas-multi-tenant',
    title: 'SaaS analytics APIs',
    summary:
      'Ship customer-facing analytics once, enforce tenant isolation automatically, and reuse the same definitions across regions.',
    body: 'Serve’s tenant config injects `WHERE account_id = $tenantId` and rejects unauthenticated requests, so every SaaS customer sees only their own metrics while you keep a single analytics codebase.',
    codeLanguage: 'typescript',
    code: `
// analytics/api.ts
import { defineServe } from '@hypequery/serve';
import { z } from 'zod';
import { verifySession } from '../lib/auth';
import { db } from './client';

export const api = defineServe({
  basePath: '/analytics',
  context: ({ request }) => ({
    db,
    auth: verifySession(request),
  }),
  tenant: {
    column: 'account_id',
    extract: (auth) => auth?.accountId,
    mode: 'auto-inject',
  },
  queries: {
    revenueByPlan: {
      inputSchema: z.object({ plan: z.string().optional() }),
      query: ({ ctx, input }) => {
        let base = ctx.db
          .table('orders')
          .where('account_id', 'eq', ctx.tenantId)
          .groupBy(['plan'])
          .sum('amount', 'revenue');

        if (input.plan) {
          base = base.where('plan', 'eq', input.plan);
        }

        return base;
      },
    },
  },
});

api.route('/revenue/by-plan', api.queries.revenueByPlan, { method: 'POST' });
await api.start();
`,
  },
  {
    id: 'dashboards',
    title: 'Dashboards',
    summary:
      'Expose a small, trusted set of metrics instead of letting every dashboard redefine business logic.',
    body: 'Product analytics, ops, and GTM dashboards call hypequery via typed hooks. A single definition feeds embeds, SSR routes, and TanStack Query caches.',
    codeLanguage: 'typescript',
    code: `
// app/analytics-hooks.ts
import { createHooks } from '@hypequery/react';

export const { useQuery, } = createHooks<DashboardApi>({
  baseUrl: '/api/analytics',
});

// app/routes/dashboard.tsx
export function Dashboard() {
  const { data, isLoading } = useQuery('kpiSnapshot', {
    startDate: '2024-05-01',
    endDate: '2024-05-31',
  });

  if (isLoading) return <SkeletonTiles />;
  return <KpiTiles rows={data} />;
}
`,
  },
  {
    id: 'agents',
    title: 'AI agents & automation',
    summary:
      'Give agents structured, discoverable analytics with typed inputs and outputs — not raw SQL strings.',
    body: 'Agents call `api.describe()` to enumerate metrics, inspect schemas, then execute them through LangChain tools so LLMs stay inside guardrails.',
    codeLanguage: 'typescript',
    code: `
// agents/tools.ts
import { DynamicStructuredTool } from 'langchain/tools';
import { z } from 'zod';
import { api } from '../analytics/api';

export async function createAnalyticsTool() {
  const catalog = api.describe();
  const metrics = new Set(catalog.queries.map((query) => query.key));

  return new DynamicStructuredTool({
    name: 'analytics_metric',
    description: 'List metrics with api.describe(), inspect schemas, and execute them safely.',
    schema: z.object({
      metric: z.string(),
      params: z.record(z.any()).default({}),
    }),
    func: async ({ metric, params }) => {
      if (!metrics.has(metric)) {
        throw new Error('Unknown metric: ' + metric);
      }

      const definition = catalog.queries.find((query) => query.key === metric);
      console.log('Executing metric', definition?.name ?? metric);
      console.log('Input schema for agent prompt', definition?.inputSchema);

      return api.execute(metric as Parameters<typeof api.execute>[0], {
        input: params,
      });
    },
  });
}

// agents/executor.ts
import { initializeAgentExecutorWithOptions } from 'langchain/agents';
import { ChatOpenAI } from '@langchain/openai';

const analyticsTool = await createAnalyticsTool();
const agent = await initializeAgentExecutorWithOptions([
  analyticsTool,
], new ChatOpenAI({ modelName: 'gpt-4o' }), {
  agentType: 'structured-chat-zero-shot-react-description',
});

const response = await agent.invoke({
  input: 'Alert me if enterprise churn grew week over week.',
});
`,
  },
];
