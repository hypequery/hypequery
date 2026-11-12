import type { ProtocolDeploymentContract } from '@hypequery/protocol';

import { publishToCloud } from '../../cloud-publishing.js';
import { dataset } from '../../dataset.js';
import { dimension } from '../../field.js';
import { coalesce, divide, nullIfZero, round, subtract } from '../../formulas.js';
import { measure } from '../../measure.js';
import { belongsTo, hasMany } from '../../relationships.js';

/**
 * A model that uses every authoring feature the TypeScript generator
 * supports, written the way a person would. Exporting its contract must give
 * back code that builds the same contract (decision 0020 §3).
 */

const PlansDataset = dataset('plans', {
  source: 'billing.plans',
  description: 'Price plans.',
  dimensions: {
    id: dimension.string(),
    region: dimension.string(),
    name: dimension.string({ label: 'Plan', synonyms: ['tier', 'package'] }),
  },
  measures: { count: measure.count('id') },
});

const AccountsDataset = dataset('accounts', {
  source: 'crm.accounts',
  rowResolution: { kind: 'final', engine: 'replacing', deletedColumn: 'is_deleted' },
  freshness: { maxAgeSeconds: 3600 },
  owner: 'data-team',
  tenantKey: 'tenant_id',
  dimensions: {
    id: dimension.string(),
    tenant_id: dimension.string({ filterable: false, groupable: false }),
    name: dimension.string({ examples: ['Northwind', 'Acme'] }),
    createdAt: dimension.timestamp({ column: 'created_at', label: 'Created' }),
  },
  measures: { accounts: measure.countDistinct('id', { label: 'Accounts' }) },
  relationships: {
    notes: hasMany(() => AccountNotesDataset, { from: 'id', to: 'account_id' }),
  },
});

const InvoicesDataset = dataset('invoices', {
  source: 'billing.invoices',
  description: "Every invoice, including credit notes (they're negative).",
  tenantKey: 'tenant_id',
  timeKey: 'issuedAt',
  defaults: { dimensions: ['status'], timeGrain: 'month' },
  dimensions: {
    id: dimension.string(),
    tenant_id: dimension.string({ filterable: false }),
    account_id: dimension.string(),
    plan_id: dimension.string(),
    plan_region: dimension.string(),
    status: dimension.string({ description: 'paid, open or void' }),
    amount: dimension.number({ unit: 'cents', currency: 'EUR', format: '0,0' }),
    issuedAt: dimension.timestamp({ column: 'issued_at' }),
    month: dimension.string({
      sql: "formatDateTime(issued_at, '%Y-%m')",
      dependencies: ['issued_at'],
      label: 'Month',
    }),
    email: dimension.string({ sensitivity: 'confidential' }),
  },
  measures: {
    revenue: measure.sum('amount', {
      label: 'Revenue',
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
    }),
    openOrPaid: measure.sum('amount', {
      filters: [{ field: 'status', operator: 'in', value: ['open', 'paid'] }],
    }),
    withEmail: measure.count('id', { filters: [{ field: 'email', operator: 'isNotNull' }] }),
    invoices: measure.count('id'),
    p90: measure.percentile('amount', 0.9),
    median: measure.median('amount'),
    latestStatus: measure.argMax('status', 'issuedAt'),
    largest: measure.max('amount'),
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
    status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'neq', 'in', 'notIn'] },
    issuedAt: { __type: 'filter_definition', field: 'issuedAt', operators: ['gte', 'lt', 'between'] },
    amount: { __type: 'filter_definition', field: 'amount', label: 'Amount' },
  },
  relationships: {
    account: belongsTo(() => AccountsDataset, { from: 'account_id', to: 'id' }),
    plan: belongsTo(() => PlansDataset, {
      keys: [{ from: 'plan_id', to: 'id' }, { from: 'plan_region', to: 'region' }],
    }),
  },
  limits: { maxResultSize: 500, maxDimensions: 6 },
});

const ActiveUsersDataset = dataset('daily_active_users', {
  source: 'events.daily_active_users',
  timeKey: 'day',
  dimensions: { day: dimension.timestamp() },
  measures: { users: measure.merge('uniq', 'users_state') },
});

const AccountNotesDataset = dataset('account_notes', {
  source: 'crm.notes',
  dimensions: { id: dimension.string(), account_id: dimension.string() },
  relationships: { account: belongsTo(() => AccountsDataset, { from: 'account_id', to: 'id' }) },
});

/** A model built in code and published as `hypequery deploy` would. */
export function codeAuthoredContract(): ProtocolDeploymentContract {
  return publishToCloud({
    datasets: {
      invoices: InvoicesDataset,
      accounts: AccountsDataset,
      daily_active_users: ActiveUsersDataset,
      account_notes: AccountNotesDataset,
    },
    access: { roles: ['analyst'], scopes: [] },
    datasetAccess: { daily_active_users: { roles: ['product'], scopes: ['events:read'] } },
  });
}
