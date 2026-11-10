import type { AuthContext } from '@hypequery/serve';

/**
 * Stand-in for your session or API-key store. In a real app the tenant comes
 * from the authenticated user, never from the request body or query string.
 */
export const DEMO_KEYS: Record<string, AuthContext & { name: string }> = {
  'demo-relay-works': { name: 'Relay Works (growth)', userId: 'grace@relay.example', tenantId: '170', roles: ['member'] },
  'demo-quartz-metrics': { name: 'Quartz Metrics (enterprise)', userId: 'ada@quartz.example', tenantId: '153', roles: ['member'] },
  'demo-helix-analytics': { name: 'Helix Analytics (starter)', userId: 'linus@helix.example', tenantId: '146', roles: ['member'] },
  // Internal finance user: no tenant, may read cross-tenant MRR.
  'demo-finance': { name: 'Finance (internal)', userId: 'finance@yourco.example', roles: ['billing'] },
};
