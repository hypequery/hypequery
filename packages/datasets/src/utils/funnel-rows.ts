import type { FunnelSpec } from './event-operation-spec.js';
import { countValue, ratio, scalar, type EventResultRow, type EventResultValue } from './event-result-values.js';

export type { EventResultRow, EventResultValue } from './event-result-values.js';

/**
 * Expand one row per funnel group (`_hq_r1 … _hq_rN`) into one row per step
 * (RFC 0027): `cohort`, breakdown values, `step`, `step_index`, `entities`,
 * both conversions and `dropoff`.
 */
export function funnelResultRows(
  spec: FunnelSpec,
  breakdownAliases: readonly string[],
  rows: readonly Record<string, unknown>[],
): EventResultRow[] {
  const result: EventResultRow[] = [];
  for (const row of rows) {
    const reached = spec.steps.map((_, index) => countValue(row[`_hq_r${index + 1}`]));
    const group: Record<string, EventResultValue> = {
      ...(spec.by === undefined ? {} : { cohort: scalar(row._hq_cohort) }),
      ...Object.fromEntries(spec.breakdown.map((name, index) => [name, scalar(row[breakdownAliases[index]!])])),
    };
    spec.steps.forEach((step, index) => {
      const entities = reached[index]!;
      const previous = index === 0 ? entities : reached[index - 1]!;
      result.push(Object.freeze({
        ...group,
        step: step.name,
        step_index: index + 1,
        entities,
        conversion_from_previous: index === 0 ? (entities === 0 ? null : 1) : ratio(entities, previous),
        conversion_from_first: ratio(entities, reached[0]!),
        dropoff: index === 0 ? 0 : previous - entities,
      }));
    });
  }
  return result;
}
