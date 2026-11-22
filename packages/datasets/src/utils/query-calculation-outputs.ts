/**
 * The output columns RFC 0026 calculations add to a result, decided from the
 * query alone: names, internal planner names, kinds and types.
 */

import type { DatasetQuery } from '../types.js';
import type { DatasetCalculationColumn, DatasetQueryCalculation, QueryCalculationKind } from './query-calculation-types.js';

/**
 * Calculation measures are planned under reserved names, so a caller's output
 * name never collides with, shadows or reveals a field of the model.
 */
export const CALCULATION_INTERNAL_PREFIX = '_hq_calc_';

export interface CalculationOutput extends DatasetCalculationColumn {
  /** The measure or column name the planners use. */
  readonly internal: string;
}

/** True when the query needs the calculation planner. */
export function hasQueryCalculations(query: Pick<DatasetQuery, 'calculations' | 'limitBy' | 'other'>): boolean {
  return (Array.isArray(query.calculations) && query.calculations.length > 0)
    || query.limitBy !== undefined
    || query.other !== undefined;
}

/** The single kind member of an entry, or undefined when it has none or several. */
export function calculationKind(entry: DatasetQueryCalculation): QueryCalculationKind | undefined {
  const kinds = (['filter', 'shift', 'window', 'formula', 'compare', 'rank', 'share'] as const)
    .filter(kind => Object.hasOwn(entry, kind));
  return kinds.length === 1 ? kinds[0] : undefined;
}

/** Every output column in output order. Entries without exactly one kind add none. */
export function calculationOutputs(query: Pick<DatasetQuery, 'calculations'>): CalculationOutput[] {
  const outputs: CalculationOutput[] = [];
  (query.calculations ?? []).forEach((entry, index) => {
    const internal = `${CALCULATION_INTERNAL_PREFIX}${index}`;
    const calculation = entry.name;
    const kind = calculationKind(entry);
    switch (kind) {
      case 'filter':
      case 'shift':
      case 'window': {
        const { measure } = (entry as unknown as Record<typeof kind, { measure: string }>)[kind];
        outputs.push({ name: entry.name, internal, kind, calculation, measure, type: 'number' });
        return;
      }
      case 'formula': {
        const { formula } = entry as Extract<DatasetQueryCalculation, { formula: unknown }>;
        outputs.push({
          name: entry.name, internal, kind, calculation, type: 'number',
          ...(formula.op === 'percentChange' ? { format: 'ratio' as const } : {}),
        });
        return;
      }
      case 'compare': {
        const { compare } = entry as Extract<DatasetQueryCalculation, { compare: unknown }>;
        compare.measures.forEach((measure, at) => {
          const base = `${internal}_${at}`;
          outputs.push(
            { name: `${measure}_previous`, internal: `${base}_previous`, kind: 'shift', calculation, measure, type: 'number' },
            { name: `${measure}_change`, internal: `${base}_change`, kind: 'formula', calculation, type: 'number' },
            { name: `${measure}_change_pct`, internal: `${base}_change_pct`, kind: 'formula', calculation, type: 'number', format: 'ratio' },
          );
        });
        return;
      }
      case 'rank': {
        const { rank } = entry as Extract<DatasetQueryCalculation, { rank: unknown }>;
        outputs.push({ name: entry.name, internal, kind, calculation, measure: rank.measure, type: 'integer' });
        return;
      }
      case 'share': {
        const { share } = entry as Extract<DatasetQueryCalculation, { share: unknown }>;
        outputs.push({ name: entry.name, internal, kind, calculation, measure: share.measure, type: 'number', format: 'ratio' });
        return;
      }
      default:
        return;
    }
  });
  return outputs;
}

/** The public metadata for each output column. */
export function calculationColumns(query: Pick<DatasetQuery, 'calculations'>): DatasetCalculationColumn[] {
  return calculationOutputs(query).map(({ internal: _internal, ...column }) => column);
}
