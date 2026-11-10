/**
 * Stand-in for your user store and session. In a real app the tenant comes
 * from the authenticated session, never from the request body.
 */
export interface DemoUser {
  email: string;
  name: string;
  tenantId: number;
  tenantName: string;
  roles: string[];
}

export const DEMO_USERS: DemoUser[] = [
  { email: 'ada@quartz.example', name: 'Ada', tenantId: 153, tenantName: 'Quartz Metrics (enterprise)', roles: ['admin'] },
  { email: 'grace@relay.example', name: 'Grace', tenantId: 170, tenantName: 'Relay Works (growth)', roles: ['viewer'] },
  { email: 'linus@helix.example', name: 'Linus', tenantId: 146, tenantName: 'Helix Analytics (starter)', roles: ['viewer'] },
];

export function findDemoUser(email: string): DemoUser | undefined {
  return DEMO_USERS.find((user) => user.email === email);
}
