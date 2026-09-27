import type { DatasetMeasureDefinition, MeasureDefinition, TimeGrain, WindowMeasureDefinition } from '../types.js';
import { isSafeSQLIdentifier } from '../sql-utils.js';
import { isBaseMeasure, isWindowMeasure } from './dataset-measures.js';

const GRAINS: ReadonlySet<string> = new Set<TimeGrain>([
  'minute', 'hour', 'day', 'week', 'month', 'quarter', 'year',
]);
const CUMULATIVE_AGGREGATIONS = new Set<MeasureDefinition['aggregation']>([
  'sum', 'count', 'min', 'max',
]);

function invalid(datasetName: string, measureName: string, detail: string): never {
  throw new Error(`Invalid dataset "${datasetName}": window measure "${measureName}" ${detail}`);
}

export function validateWindowMeasures(
  datasetName: string,
  timeKey: string | undefined,
  measures: Record<string, DatasetMeasureDefinition>,
): void {
  for (const [name, definition] of Object.entries(measures)) {
    if (!definition || !isWindowMeasure(definition)) continue;
    if (!isSafeSQLIdentifier(name)) invalid(datasetName, name, 'name is not a safe identifier.');
    if (!timeKey) invalid(datasetName, name, 'requires a timeKey.');
    const window = definition as WindowMeasureDefinition;
    const base = Object.hasOwn(measures, window.measure) ? measures[window.measure] : undefined;
    if (!base || !isBaseMeasure(base)) {
      invalid(datasetName, name, `must wrap a base measure; "${String(window.measure)}" is not one.`);
    }
    const modes = Number(window.trailing !== undefined)
      + Number(window.toDate !== undefined)
      + Number(window.cumulative !== undefined);
    if (modes !== 1) invalid(datasetName, name, 'must declare exactly one window mode.');
    if (window.trailing !== undefined) {
      const { amount, unit } = window.trailing;
      if (!Number.isSafeInteger(amount) || amount <= 0 || !GRAINS.has(unit)) {
        invalid(datasetName, name, 'trailing interval needs a positive safe integer and supported unit.');
      }
    }
    if (window.toDate !== undefined && (String(window.toDate) === 'minute' || !GRAINS.has(window.toDate))) {
      invalid(datasetName, name, 'toDate needs a supported grain coarser than minute.');
    }
    if (window.cumulative !== undefined) {
      if (window.cumulative !== true) invalid(datasetName, name, 'cumulative must be true.');
      if (!CUMULATIVE_AGGREGATIONS.has(base.aggregation)) {
        invalid(datasetName, name, `cannot accumulate ${base.aggregation}; use sum, count, min, or max.`);
      }
    }
  }
}
