import { mintAgentToken } from '@hypequery/agent';
import { hypequeryTools, type HypequeryAIToolSet } from '@hypequery/agent/ai-sdk';
import { publishDatasets } from '@hypequery/datasets';
import { createMCPExecutor } from '@hypequery/mcp';
import { businessContext } from '@/analytics/business-context';
import { Events } from '@/analytics/datasets';
import { analytics } from './analytics';
import type { DemoUser } from './demo-users';
import { refreshingToken } from './refreshing-token';

/** The tools the agent gets, in either mode: the same set as Cloud's tenant endpoint. */
export const AGENT_TOOLS = ['list_datasets', 'get_dataset_schema', 'query_dataset', 'get_business_context'];

/** `cloud` (the default) or `self-hosted`. Explicit, so a missing key never silently switches modes. */
export function agentMode(): 'cloud' | 'self-hosted' {
  const mode = process.env.HYPEQUERY_MODE ?? 'cloud';
  if (mode !== 'cloud' && mode !== 'self-hosted') {
    throw new Error(`HYPEQUERY_MODE must be "cloud" or "self-hosted", not "${mode}".`);
  }
  return mode;
}

const datasets = publishDatasets().publish(Events).build();

/**
 * The hypequery tools for one signed-in user, as AI SDK tools. Either way the
 * tenant comes from your server-side session, never the request or the model.
 *
 * - cloud: mint an end-user token for the session and use the project's tenant
 *   MCP endpoint. Cloud verifies the token and scopes every query to its tenant.
 * - self-hosted: run the same tools in this process over your ClickHouse. The
 *   executor's `tenantId` scopes every query; there is no token and no network
 *   hop. Create the executor per request, since it is bound to one tenant.
 */
export async function agentTools(session: DemoUser): Promise<HypequeryAIToolSet> {
  if (agentMode() === 'self-hosted') {
    const executor = createMCPExecutor({ datasets, analytics, tenantId: session.tenantId, businessContext });
    return hypequeryTools({ executor, tools: AGENT_TOOLS });
  }

  const { mcpUrl, token } = await refreshingToken(() =>
    mintAgentToken({
      signingKey: process.env.HYPEQUERY_AGENT_KEY!,
      tenant: session.tenantId,
      subject: session.id,
      permissionSet: process.env.HYPEQUERY_PERMISSION_SET ?? 'customers',
    }),
  );
  // `token` is a function, so a long conversation gets a fresh token before the old one expires.
  return hypequeryTools({ url: mcpUrl, token });
}
