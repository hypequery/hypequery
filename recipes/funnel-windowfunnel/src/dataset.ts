import { dataset, dimension, divide, gte, measure, nullIfZero } from '@hypequery/datasets';

/**
 * The funnel as a dataset. The view (sql/user-funnel.sql) stores each user's
 * windowFunnel level per month: 0 = no login, 1 = logged in, 2 = then ran a
 * query, 3 = then exported, all inside 24 hours. "Reached step N" is then an
 * ordinary filtered distinct count, and conversion is a derived measure.
 */
export const Funnel = dataset('loginToExportFunnel', {
  source: 'funnel_windowfunnel_user_levels',
  timeKey: 'month',
  timeGrains: ['month', 'quarter', 'year'],
  dimensions: {
    tenantId: dimension.number({ column: 'tenant_id', label: 'Tenant' }),
    month: dimension.timestamp({ column: 'month', label: 'Month' }),
    userId: dimension.number({ column: 'user_id' }),
    funnelLevel: dimension.number({ column: 'funnel_level', label: 'Deepest step reached' }),
  },
  measures: {
    loggedIn: measure.countDistinct('userId', { label: 'Step 1: logged in', filters: [gte('funnelLevel', 1)] }),
    ranQuery: measure.countDistinct('userId', { label: 'Step 2: ran a query', filters: [gte('funnelLevel', 2)] }),
    exported: measure.countDistinct('userId', { label: 'Step 3: exported', filters: [gte('funnelLevel', 3)] }),
    queryRate: measure.derived({
      label: 'Login to query',
      uses: { from: 'loggedIn', to: 'ranQuery' },
      formula: ({ from, to }) => divide(to, nullIfZero(from)),
    }),
    exportRate: measure.derived({
      label: 'Query to export',
      uses: { from: 'ranQuery', to: 'exported' },
      formula: ({ from, to }) => divide(to, nullIfZero(from)),
    }),
    conversion: measure.derived({
      label: 'Login to export',
      description: 'Share of users who logged in and went on to export within 24 hours',
      uses: { from: 'loggedIn', to: 'exported' },
      formula: ({ from, to }) => divide(to, nullIfZero(from)),
    }),
  },
});
