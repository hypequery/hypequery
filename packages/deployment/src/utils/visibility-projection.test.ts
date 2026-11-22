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

  it('keeps an alternate named by the column a visible dimension reads', () => {
    const byColumn = {
      ...dataset,
      alternateTimeFields: ['shipped_at'],
      dimensions: [
        { name: 'shippedAt', type: 'timestamp', source: { kind: 'column', column: 'shipped_at' }, filterable: true, groupable: true },
      ],
    };
    expect((narrowDatasetToVisible(byColumn as never, visible(['createdAt', 'shippedAt']) as never) as Record<string, unknown>)
      .alternateTimeFields).toEqual(['shipped_at']);
    expect(narrowDatasetToVisible(byColumn as never, visible(['createdAt']) as never)).not.toHaveProperty('alternateTimeFields');
  });

  it('never shows a hidden dimension through another dimension that reads its name as a column', () => {
    // `shipped_at` names a hidden dimension; `shippedAt` merely reads a column of that name.
    const shadowed = {
      ...dataset,
      alternateTimeFields: ['shipped_at'],
      dimensions: [
        { name: 'shipped_at', type: 'timestamp', source: { kind: 'column', column: 'private_at' }, filterable: true, groupable: true },
        { name: 'shippedAt', type: 'timestamp', source: { kind: 'column', column: 'shipped_at' }, filterable: true, groupable: true },
      ],
    };
    expect(narrowDatasetToVisible(shadowed as never, visible(['createdAt', 'shippedAt']) as never)).not.toHaveProperty('alternateTimeFields');
    expect((narrowDatasetToVisible(shadowed as never, visible(['createdAt', 'shipped_at']) as never) as Record<string, unknown>)
      .alternateTimeFields).toEqual(['shipped_at']);
  });
});
