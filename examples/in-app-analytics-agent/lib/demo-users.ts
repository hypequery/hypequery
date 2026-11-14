/**
 * Stand-in for your user store. Two people at two different customers of
 * your product, so you can watch tenancy work: switch user and every answer
 * changes. The tenant ids are seed tenants (examples/_seed), registered as
 * customers in Cloud with the same ids.
 */
export interface DemoUser {
  id: string;
  name: string;
  tenantId: string;
  tenantName: string;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { id: 'ada', name: 'Ada', tenantId: '4', tenantName: 'Northwind Analytics' },
  { id: 'grace', name: 'Grace', tenantId: '153', tenantName: 'Quartz Metrics' },
];

export function findDemoUser(id: string | undefined): DemoUser | undefined {
  return DEMO_USERS.find((user) => user.id === id);
}
