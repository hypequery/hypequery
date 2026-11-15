import { dataset, dimension, measure } from '@hypequery/datasets';
import { describe, expect, it } from 'vitest';
import { parseToolArgs } from '../args.js';
import { buildMCPQuerySchemas } from './canonical-query-schemas.js';

const events = dataset('events', { source: 'events', dimensions: { device: dimension.string() }, measures: { events: measure.count() } });
const subscriptions = dataset('subscriptions', { source: 'subscriptions', dimensions: { plan: dimension.string() }, measures: { subscriptions: measure.count() } });
const schema = buildMCPQuerySchemas({ events, subscriptions }).queryDataset;

function message(args: unknown): string {
  try {
    parseToolArgs(schema, 'query_dataset', args);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to be rejected');
}

describe('argument errors for a per-dataset union', () => {
  it('reports the named dataset’s own problem, not a bare "Invalid input"', () => {
    expect(message({ dataset: 'events', dimensions: ['plan'], measures: ['events'] }))
      .toBe('Invalid query_dataset arguments: dimensions.0: Invalid input: expected "device"');
    expect(message({ dataset: 'events', measures: ['events'], filters: [{ field: 'plan', operator: 'eq', value: 'x' }] }))
      .toBe('Invalid query_dataset arguments: filters.0.field: Invalid input: expected "device"');
  });

  it('lists the offered datasets when none matches', () => {
    expect(message({ dataset: 'orders', measures: ['events'] }))
      .toBe('Invalid query_dataset arguments: dataset: expected one of "events", "subscriptions"');
  });

  it('never repeats a submitted value', () => {
    expect(message({ dataset: 'events', dimensions: ['SECRET'] })).not.toContain('SECRET');
    expect(message({ dataset: 'SECRET' })).not.toContain('SECRET');
  });
});
