import { describe, expect, it } from 'vitest';
import { narrowDatasetToVisible } from './visibility-projection.js';

const dataset = {
  name: 'orders',
  timeField: 'createdAt',
  alternateTimeFields: ['shippedAt', 'deliveredAt'],
  dimensions: [],
  measures: [],
  allowedFilters: [],
  relationships: [],
} as const;

const visible = (dimensions: string[], timeField = true) => ({
  dimensions: new Set(dimensions),
  measures: new Set<string>(),
  filters: new Set<string>(),
  relationships: new Set<string>(),
  timeField,
  segments: undefined,
});

describe('alternate time fields under visibility (RFC 0029)', () => {
  it('keeps only the alternates whose dimensions are visible', () => {
    const narrowed = narrowDatasetToVisible(dataset as never, visible(['createdAt', 'deliveredAt']) as never) as Record<string, unknown>;
    expect(narrowed.alternateTimeFields).toEqual(['deliveredAt']);
  });

  it('drops them with a hidden time field, or when none is visible', () => {
    expect(narrowDatasetToVisible(dataset as never, visible(['shippedAt'], false) as never)).not.toHaveProperty('alternateTimeFields');
    expect(narrowDatasetToVisible(dataset as never, visible(['createdAt']) as never)).not.toHaveProperty('alternateTimeFields');
  });
});
