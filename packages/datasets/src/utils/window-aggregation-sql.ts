import type { MeasureDefinition } from '../types.js';

/** NULL for an empty non-count population, including nullable measure inputs. */
export function windowAggregateSql(definition: MeasureDefinition, value: string, arg: string): string {
  switch (definition.aggregation) {
    case 'count': return `count(${value})`;
    case 'countDistinct': return `uniqExact(${value})`;
    case 'approxCountDistinct': return `uniq(${value})`;
    case 'percentile': return `quantileOrNull(${definition.level})(${value})`;
    case 'argMax': return `argMaxOrNull(${value}, ${arg})`;
    case 'argMin': return `argMinOrNull(${value}, ${arg})`;
    case 'stddev': return `stddevSampOrNull(${value})`;
    case 'variance': return `varSampOrNull(${value})`;
    default: return `${definition.aggregation}OrNull(${value})`;
  }
}

export function isCountAggregation(definition: MeasureDefinition): boolean {
  return ['count', 'countDistinct', 'approxCountDistinct'].includes(definition.aggregation);
}
