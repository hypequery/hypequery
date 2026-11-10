/**
 * Plan pricing lives in code, reviewed like any other change. Prices are
 * decimal strings, never floats. The base fee is not here: it comes from the
 * tenant's subscription row, the amount they actually agreed to.
 */
export type Meter = 'apiCalls' | 'queryRuns';

export interface MeterPrice {
  /** Units included in the base fee each billing period. */
  included: number;
  /** Price per unit above `included`, in the plan currency. */
  overageUnitPrice: string;
  label: string;
}

export const PLANS: Record<string, Record<Meter, MeterPrice>> = {
  starter: {
    apiCalls: { included: 25, overageUnitPrice: '0.04', label: 'API calls' },
    queryRuns: { included: 10, overageUnitPrice: '0.075', label: 'Query runs' },
  },
  growth: {
    apiCalls: { included: 150, overageUnitPrice: '0.025', label: 'API calls' },
    queryRuns: { included: 100, overageUnitPrice: '0.05', label: 'Query runs' },
  },
  enterprise: {
    apiCalls: { included: 2000, overageUnitPrice: '0.0125', label: 'API calls' },
    queryRuns: { included: 1000, overageUnitPrice: '0.025', label: 'Query runs' },
  },
};

export const METERS: Meter[] = ['apiCalls', 'queryRuns'];
