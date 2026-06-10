/**
 * Unit tests for MCP tool argument validation.
 */

import { describe, it, expect } from 'vitest';
import {
  parseQueryMetricArgs,
  parseQueryDatasetArgs,
  parseGetDatasetSchemaArgs,
} from './args.js';

describe('parseQueryMetricArgs', () => {
  it('accepts a fully-specified valid query', () => {
    const parsed = parseQueryMetricArgs({
      dataset: 'orders',
      metric: 'revenue',
      dimensions: ['region'],
      filters: [{ field: 'status', operator: 'eq', value: 'paid' }],
      grain: 'month',
      orderBy: [{ field: 'revenue', direction: 'desc' }],
      limit: 100,
    });
    expect(parsed.metric).toBe('revenue');
    expect(parsed.filters).toEqual([{ field: 'status', operator: 'eq', value: 'paid' }]);
  });

  it('allows dataset/metric to be omitted (checked later by the tool)', () => {
    expect(() => parseQueryMetricArgs({})).not.toThrow();
  });

  it('rejects an unknown filter operator', () => {
    expect(() =>
      parseQueryMetricArgs({
        dataset: 'orders',
        metric: 'revenue',
        filters: [{ field: 'status', operator: 'contains', value: 'x' }],
      })
    ).toThrow(/Invalid arguments.*operator/s);
  });

  it('rejects an unknown grain', () => {
    expect(() =>
      parseQueryMetricArgs({ dataset: 'orders', metric: 'revenue', grain: 'fortnight' })
    ).toThrow(/Invalid arguments.*grain/s);
  });

  it('rejects a non-numeric limit', () => {
    expect(() =>
      parseQueryMetricArgs({ dataset: 'orders', metric: 'revenue', limit: 'lots' })
    ).toThrow(/Invalid arguments.*limit/s);
  });

  it('rejects a non-string dataset', () => {
    expect(() => parseQueryMetricArgs({ dataset: 123 })).toThrow(/Invalid arguments.*dataset/s);
  });

  it('strips unknown top-level keys', () => {
    const parsed = parseQueryMetricArgs({ dataset: 'orders', metric: 'revenue', bogus: true });
    expect(parsed).not.toHaveProperty('bogus');
  });
});

describe('parseQueryDatasetArgs', () => {
  it('accepts dimensions and metrics', () => {
    const parsed = parseQueryDatasetArgs({
      dataset: 'orders',
      dimensions: ['region'],
      metrics: ['revenue'],
    });
    expect(parsed.dimensions).toEqual(['region']);
    expect(parsed.metrics).toEqual(['revenue']);
  });

  it('rejects an invalid orderBy direction', () => {
    expect(() =>
      parseQueryDatasetArgs({
        dataset: 'orders',
        orderBy: [{ field: 'revenue', direction: 'sideways' }],
      })
    ).toThrow(/Invalid arguments.*direction/s);
  });
});

describe('parseGetDatasetSchemaArgs', () => {
  it('accepts an empty object', () => {
    expect(() => parseGetDatasetSchemaArgs({})).not.toThrow();
  });

  it('rejects a non-string dataset', () => {
    expect(() => parseGetDatasetSchemaArgs({ dataset: 42 })).toThrow(/Invalid arguments/);
  });
});
