import { describe, expect, it } from 'vitest';
import { dataset } from '../dataset.js';
import { dimension } from '../field.js';
import type { AggregationSpec, MetricFilter } from '../types.js';
import { applyFilteredAggregationExpression } from './filtered-aggregation-sql.js';

const Sales = dataset('sales', { source: 'sales', dimensions: { value: dimension.number() } });

function render(operator: MetricFilter['operator'], value: unknown, aggregation: AggregationSpec['aggregation'] = 'sum') {
  return applyFilteredAggregationExpression(Sales, {
    aggregation,
    filters: [{ field: 'value', operator, value } as MetricFilter],
  } as AggregationSpec, 'amount');
}

describe('filtered aggregate SQL', () => {
  it.each([
    ['eq', null, 'value = NULL'], ['neq', true, 'value != 1'], ['gt', false, 'value > 0'],
    ['gte', 5, 'value >= 5'], ['lt', 5, 'value < 5'], ['lte', 5, 'value <= 5'],
    ['like', 'a%', "value LIKE 'a%'"], ['in', [1, 2], 'value IN (1, 2)'],
    ['notIn', [1, 2], 'value NOT IN (1, 2)'], ['between', [1, 2], 'value BETWEEN 1 AND 2'],
    ['eq', "x\\' OR 1=1 --", "value = 'x\\\\'' OR 1=1 --'"],
  ] as const)('renders %s predicates with safe literal values', (operator, value, condition) => {
    expect(render(operator, value)).toBe(`if((${condition}), amount, 0)`);
  });

  it.each(['count', 'countDistinct', 'avg', 'min', 'max', 'percentile', 'stddev', 'variance', 'approxCountDistinct'] as const)(
    'excludes non-matching rows from %s', aggregation => {
      expect(render('eq', 1, aggregation)).toBe('if((value = 1), amount, NULL)');
    },
  );

  it('combines all fixed filters and leaves unfiltered expressions unchanged', () => {
    expect(applyFilteredAggregationExpression(Sales, { aggregation: 'sum' }, 'amount')).toBe('amount');
    expect(applyFilteredAggregationExpression(Sales, {
      aggregation: 'sum', filters: [
        { field: 'value', operator: 'gt', value: 1 }, { field: 'value', operator: 'lt', value: 10 },
      ],
    }, 'amount')).toBe('if((value > 1) AND (value < 10), amount, 0)');
  });

  it.each([
    ['in', [], 'non-empty array'], ['notIn', 1, 'non-empty array'],
    ['between', [1], 'two-item array'], ['between', 1, 'two-item array'],
    ['eq', Infinity, 'non-finite'], ['eq', {}, 'Unsupported literal type'],
  ] as const)('rejects invalid %s literals before SQL execution', (operator, value, error) => {
    expect(() => render(operator, value)).toThrow(error);
  });

  it.each(['argMax', 'argMin'] as const)('rejects fixed filters on %s', aggregation => {
    expect(() => render('eq', 1, aggregation)).toThrow(`Measure filters are not supported on ${aggregation}`);
  });
});
