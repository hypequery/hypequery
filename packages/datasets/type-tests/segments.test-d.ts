import { dataset, dimension, measure, type DatasetQuery, type SegmentDefinition } from '../src/index.js';

const enterprise: SegmentDefinition = {
  label: 'Enterprise',
  filters: [{ field: 'tier', operator: 'eq', value: 'enterprise' }],
};

const Accounts = dataset('accounts', {
  source: 'accounts',
  dimensions: { tier: dimension.string() },
  measures: { revenue: measure.sum('amount') },
  segments: { enterprise },
});
void Accounts;

const query: DatasetQuery = { measures: ['revenue'], segments: ['enterprise'] };
void query;

dataset('bad', {
  source: 'accounts',
  dimensions: { tier: dimension.string() },
  // @ts-expect-error a segment needs filters.
  segments: { empty: { label: 'Empty' } },
});
