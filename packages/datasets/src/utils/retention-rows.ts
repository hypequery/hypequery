import type { RetentionSpec } from './event-operation-spec.js';
import { countValue, ratio, scalar, type EventResultRow, type EventResultValue } from './event-result-values.js';

/**
 * Expand one row per cohort (`_hq_size`, `_hq_retained[]`, `_hq_observable`)
 * into one row per observable period (RFC 0027): breakdown values, `cohort`,
 * `period`, `entities`, `retained` and `rate`.
 */
export function retentionResultRows(
  spec: RetentionSpec,
  breakdownAliases: readonly string[],
  rows: readonly Record<string, unknown>[],
): EventResultRow[] {
  const result: EventResultRow[] = [];
  for (const row of rows) {
    const entities = countValue(row._hq_size);
    const retained = row._hq_retained;
    if (!Array.isArray(retained) || retained.length !== spec.periods) {
      throw new Error('The executor returned retention counts of the wrong length.');
    }
    const observable = Math.min(countValue(row._hq_observable), spec.periods);
    const group: Record<string, EventResultValue> = Object.fromEntries(
      spec.breakdown.map((name, index) => [name, scalar(row[breakdownAliases[index]!])]),
    );
    for (let period = 1; period <= observable; period += 1) {
      const count = countValue(retained[period - 1]);
      result.push(Object.freeze({
        ...group,
        cohort: scalar(row._hq_cohort),
        period,
        entities,
        retained: count,
        rate: ratio(count, entities),
      }));
    }
  }
  return result;
}
