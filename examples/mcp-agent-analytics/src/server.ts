import { createMCPServer } from '@hypequery/mcp';
import { publishDatasets } from '@hypequery/datasets';
import { analytics } from '../analytics/client.js';
import { Events, Subscriptions } from '../analytics/datasets.js';

/**
 * A governed MCP server over the seed dataset.
 *
 * The agent gets exactly four tools: list_datasets, get_dataset_schema,
 * query_dataset and query_metric. It can only reach the datasets published
 * here, with the dimensions and measures they declare; generated SQL is
 * redacted; and because both datasets have a tenantKey, every query is
 * scoped to the tenant this process was started for. The tenant comes from
 * the environment the MCP client launches the server with, never from the
 * agent.
 */
const tenantId = process.env.TENANT_ID;
if (!tenantId) {
  console.error('Set TENANT_ID to the tenant this server is allowed to see, e.g. TENANT_ID=153.');
  process.exit(2);
}

export const datasets = publishDatasets().publish(Events).publish(Subscriptions).build();

await createMCPServer({
  datasets,
  analytics,
  tenantId,
  name: 'hypequery-seed-analytics',
  version: '0.1.0',
  // Only turn on in a trusted debugging session: it puts SQL in tool results.
  includeSql: process.env.HYPEQUERY_MCP_INCLUDE_SQL === '1',
});
// The server now speaks MCP over stdio until the client closes the pipe.
