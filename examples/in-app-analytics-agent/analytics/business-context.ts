import { defineBusinessContext } from '@hypequery/datasets';

/**
 * Reviewed business context for the agent: what the numbers mean here. It is
 * published with the datasets (`analytics/cloud.ts`) and, self-hosted, handed to
 * the tool executor (`lib/agent-tools.ts`). The agent reads it from
 * `list_datasets` and `get_business_context`; it never changes a query result.
 */
export const businessContext = defineBusinessContext({
  summary: 'A B2B analytics product. Each customer is a company whose team uses the web app and the API.',
  audience: 'Customer admins and team leads asking about their own team’s usage, reliability and adoption.',
  kpis: [
    { name: 'Active users', definition: 'Distinct users with at least one event in the period (the uniqueUsers measure).' },
    { name: 'Error rate', definition: 'Server errors (HTTP 5xx) divided by all events, from 0 to 1. Report it as a percentage.' },
    { name: 'p95 latency', definition: 'Approximate 95th percentile of request latency in milliseconds. Lower is better.' },
  ],
  glossary: [
    { term: 'Customer', meaning: 'The company the signed-in user belongs to. The agent only ever sees this customer.' },
    { term: 'Event', meaning: 'One tracked action: page_view, api_call, query_run, login, export or error.' },
    { term: 'API usage', meaning: 'Events with event_type api_call, or device api.' },
  ],
  conventions: 'Times are UTC. Weeks start on Monday. Unless asked otherwise, compare the last 30 days with the 30 days before.',
  caveats: [
    'Status codes 4xx are client errors and are not counted in the error rate.',
    'Latency is not recorded for login events.',
  ],
});
