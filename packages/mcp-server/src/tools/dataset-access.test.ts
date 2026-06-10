/**
 * Unit tests for shared dataset-access helpers.
 */

import { describe, it, expect } from 'vitest';
import { resolveDataset, textResponse } from './dataset-access.js';

describe('resolveDataset', () => {
  it('throws when the dataset name is missing', () => {
    expect(() => resolveDataset({}, undefined)).toThrow('dataset parameter is required');
    expect(() => resolveDataset({}, '')).toThrow('dataset parameter is required');
  });

  it('throws when the dataset is not found', () => {
    expect(() => resolveDataset({}, 'orders')).toThrow('Dataset not found: orders');
  });

  it('returns the matching dataset', () => {
    const orders = { source: 'orders_table' };
    expect(resolveDataset({ orders }, 'orders')).toBe(orders);
  });
});

describe('textResponse', () => {
  it('wraps a payload in the MCP text-content shape', () => {
    const response = textResponse({ a: 1 });
    expect(response).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ a: 1 }, null, 2) }],
    });
  });
});
