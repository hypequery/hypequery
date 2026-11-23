import { describe, expect, it } from 'vitest';
import { PROTOCOL_CONTRACT_3_FEATURE_LABELS, datasetContract3Features } from '@hypequery/protocol';
import { buildProtocolDeploymentContract, dataset, dimension, eq, measure } from '../index.js';
import { contract3AuthoringDataset } from '../contract-3-authoring.fixture.js';
import { contract3Features } from './protocol-contract-3.js';

const config = {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: { amount: dimension.number(), status: dimension.string(), createdAt: dimension.timestamp(), shippedAt: dimension.timestamp() },
};

const DATASETS = {
  none: dataset('orders', { ...config, measures: { revenue: measure.sum('amount') } }),
  segments: dataset('orders', { ...config, measures: { revenue: measure.sum('amount') }, segments: { paid: { filters: [eq('status', 'paid')] } } }),
  windows: dataset('orders', { ...config, measures: { revenue: measure.sum('amount'), running: measure.cumulative('revenue') } }),
  shifts: dataset('orders', { ...config, measures: { revenue: measure.sum('amount'), prior: measure.shift('revenue', { amount: 1, unit: 'day' }) } }),
  approx: dataset('orders', { ...config, measures: { buyers: measure.approxCountDistinct('status') } }),
  subDay: dataset('orders', { ...config, measures: { revenue: measure.sum('amount') }, defaults: { timeGrain: 'hour' } }),
  timeKeys: dataset('orders', { ...config, timeKeys: ['shippedAt'], measures: { revenue: measure.sum('amount') } }),
  everything: contract3AuthoringDataset,
};

describe('contract 3 feature names', () => {
  // RFC 0030: the CLI names forcing features from the built contract, so the
  // authoring rule that picks the version must agree with the contract rule.
  it.each(Object.entries(DATASETS))('agree between authoring and the published contract: %s', (_name, ds) => {
    const published = buildProtocolDeploymentContract([ds]).datasets[0]!;
    expect(contract3Features(ds)).toEqual(
      datasetContract3Features(published).map(feature => PROTOCOL_CONTRACT_3_FEATURE_LABELS[feature]),
    );
  });
});
