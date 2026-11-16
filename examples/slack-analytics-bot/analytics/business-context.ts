import { defineBusinessContext } from '@hypequery/datasets';

/** What the numbers mean here. The agent reads it from `list_datasets` and `get_business_context`. */
export const businessContext = defineBusinessContext({
  summary: 'A B2B analytics product. Each customer is a company whose team uses the web app and the API.',
  audience: 'Our own team (product, support, leadership) asking about usage, reliability and revenue in Slack.',
  kpis: [
    { name: 'Active users', definition: 'Distinct users with at least one event in the period (the uniqueUsers measure).' },
    { name: 'Error rate', definition: 'Server errors (HTTP 5xx) divided by all events, from 0 to 1. Report it as a percentage.' },
    { name: 'p95 latency', definition: 'Approximate 95th percentile of request latency in milliseconds. Lower is better.' },
  ],
  glossary: [
    { term: 'Customer', meaning: 'A company using the product, identified by tenantId.' },
    { term: 'Event', meaning: 'One tracked action: page_view, api_call, query_run, login, export or error.' },
  ],
  conventions: 'Times are UTC. Weeks start on Monday. The data covers 2025-11-01 to 2026-10-31.',
  caveats: [
    'Status codes 4xx are client errors and are not counted in the error rate.',
    'Billed amounts are in the currency the customer pays in (USD or EUR). Report each currency separately; never add them together or convert between them.',
  ],
});
