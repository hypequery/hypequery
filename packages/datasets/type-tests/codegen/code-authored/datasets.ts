// Round-trip fixture for @hypequery/datasets/codegen. Regenerate with `vitest -u`.

import { type AnyDatasetInstance, belongsTo, coalesce, dataset, dimension, divide, hasMany, measure, nullIfZero, round, subtract } from '../../../src/index.js';

export const AccountsDataset = dataset('accounts', {
  source: 'crm.accounts',
  rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' },
  freshness: { maxAgeSeconds: 3600 },
  owner: 'data-team',
  tenantKey: 'tenant_id',
  dimensions: {
    createdAt: dimension.timestamp({ label: 'Created', column: 'created_at' }),
    id: dimension.string(),
    name: dimension.string({ examples: ['Acme', 'Northwind'] }),
    tenant_id: dimension.string({ filterable: false, groupable: false }),
  },
  measures: { accounts: measure.countDistinct('id', { label: 'Accounts' }) },
  relationships: {
    notes: hasMany((): AnyDatasetInstance => AccountNotesDataset, { from: 'id', to: 'account_id' }),
  },
});

export const AccountNotesDataset = dataset('account_notes', {
  source: 'crm.notes',
  dimensions: { account_id: dimension.string(), id: dimension.string() },
  relationships: { account: belongsTo(() => AccountsDataset, { from: 'account_id', to: 'id' }) },
});

export const DailyActiveUsersDataset = dataset('daily_active_users', {
  source: 'events.daily_active_users',
  timeKey: 'day',
  dimensions: { day: dimension.timestamp() },
  measures: { users: measure.merge('uniq', 'users_state') },
});

export const PlansDataset = dataset('plans', {
  source: 'billing.plans',
  description: 'Price plans.',
  dimensions: {
    id: dimension.string(),
    name: dimension.string({ label: 'Plan', synonyms: ['package', 'tier'] }),
    region: dimension.string(),
  },
  measures: { count: measure.count('id') },
});

export const InvoicesDataset = dataset('invoices', {
  source: 'billing.invoices',
  description: "Every invoice, including credit notes (they're negative).",
  tenantKey: 'tenant_id',
  timeKey: 'issuedAt',
  defaults: { dimensions: ['status'], timeGrain: 'month' },
  dimensions: {
    account_id: dimension.string(),
    amount: dimension.number({ format: '0,0', unit: 'cents', currency: 'EUR' }),
    email: dimension.string({ sensitivity: 'confidential' }),
    id: dimension.string(),
    issuedAt: dimension.timestamp({ column: 'issued_at' }),
    month: dimension.string({ label: 'Month', sql: "formatDateTime(issued_at, '%Y-%m')", dependencies: ['issued_at'] }),
    plan_id: dimension.string(),
    plan_region: dimension.string(),
    status: dimension.string({ description: 'paid, open or void' }),
    tenant_id: dimension.string({ filterable: false }),
  },
  measures: {
    invoices: measure.count('id'),
    largest: measure.max('amount'),
    latestStatus: measure.argMax('status', 'issuedAt'),
    median: measure.median('amount'),
    openOrPaid: measure.sum('amount', { filters: [{ field: 'status', operator: 'in', value: ['open', 'paid'] }] }),
    p90: measure.percentile('amount', 0.9),
    revenue: measure.sum('amount', { label: 'Revenue', filters: [{ field: 'status', operator: 'eq', value: 'paid' }] }),
    withEmail: measure.count('id', { filters: [{ field: 'email', operator: 'isNotNull' }] }),
    averageInvoice: measure.derived({
      uses: { total: 'revenue', count: 'invoices' },
      formula: ({ total, count }) => round(divide(total, nullIfZero(count)), 2),
      label: 'Average invoice',
    }),
    unpaid: measure.derived({
      uses: { all: 'openOrPaid', paid: 'revenue' },
      formula: ({ all, paid }) => coalesce(subtract(all, paid), 0),
    }),
  },
  filters: {
    amount: { __type: 'filter_definition', field: 'amount', label: 'Amount' },
    issuedAt: { __type: 'filter_definition', field: 'issuedAt', operators: ['gte', 'lt', 'between'] },
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn'] },
  },
  relationships: {
    account: belongsTo(() => AccountsDataset, { from: 'account_id', to: 'id' }),
    plan: belongsTo(() => PlansDataset, { keys: [{ from: 'plan_id', to: 'id' }, { from: 'plan_region', to: 'region' }] }),
  },
  limits: { maxDimensions: 6, maxResultSize: 500 },
});

/** The datasets published with an endpoint. */
export const datasets = {
  account_notes: AccountNotesDataset,
  accounts: AccountsDataset,
  daily_active_users: DailyActiveUsersDataset,
  invoices: InvoicesDataset,
};
