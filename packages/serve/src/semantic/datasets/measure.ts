import type { MeasureDefinition, MeasureOptions, MeasureAggregation } from './types.js';

function createMeasureHelper(aggregation: MeasureAggregation) {
  return (field: string, opts?: MeasureOptions): MeasureDefinition => ({
    __type: 'measure_definition',
    aggregation,
    field,
    label: opts?.label,
    description: opts?.description,
  });
}

export const measure = {
  sum: createMeasureHelper('sum'),
  count: createMeasureHelper('count'),
  countDistinct: createMeasureHelper('countDistinct'),
  avg: createMeasureHelper('avg'),
  min: createMeasureHelper('min'),
  max: createMeasureHelper('max'),
} as const;
