import type { DatasetMeasureDefinition, MeasureDefinition, WindowMeasureDefinition } from '../types.js';
import { SUPPORTED_TIME_GRAINS } from '../constants.js';
import { isSafeSQLIdentifier } from '../sql-utils.js';
import { getBaseMeasure, isWindowMeasure } from './dataset-measures.js';

const TRAILING_UNITS: ReadonlySet<string> = new Set(SUPPORTED_TIME_GRAINS);
const TO_DATE_GRAINS: ReadonlySet<string> = new Set(SUPPORTED_TIME_GRAINS.filter(grain => grain !== 'minute'));
const CUMULATIVE_AGGREGATIONS: ReadonlySet<string> = new Set(['sum', 'count', 'min', 'max']);

export function validateWindowMeasures(
  datasetName: string,
  timeKey: string | undefined,
  measures: Record<string, DatasetMeasureDefinition>,
): void {
  for (const [name, definition] of Object.entries(measures)) {
    if (!isWindowMeasure(definition)) continue;
    const problem = windowMeasureProblem(name, definition, timeKey, measures);
    if (problem) {
      throw new Error(`Invalid dataset "${datasetName}": window measure "${name}" ${problem}`);
    }
  }
}

/** Why a window measure is invalid, or undefined when it is valid. */
function windowMeasureProblem(
  name: string,
  definition: WindowMeasureDefinition,
  timeKey: string | undefined,
  measures: Record<string, DatasetMeasureDefinition>,
): string | undefined {
  if (!isSafeSQLIdentifier(name)) return 'name is not a safe identifier.';
  if (!timeKey) return 'requires a timeKey.';
  const base = getBaseMeasure(measures, definition.measure);
  if (!base) return `must wrap a base measure; "${String(definition.measure)}" is not one.`;
  return windowModeProblem(definition, base);
}

/** Checks that exactly one of trailing / toDate / cumulative is declared, and that it is well formed. */
function windowModeProblem(definition: WindowMeasureDefinition, base: MeasureDefinition): string | undefined {
  const { trailing, toDate, cumulative } = definition;
  const declaredModes = [trailing, toDate, cumulative].filter(mode => mode !== undefined).length;
  if (declaredModes !== 1) return 'must declare exactly one window mode.';

  if (trailing !== undefined) {
    const valid = typeof trailing === 'object' && trailing !== null
      && Number.isSafeInteger(trailing.amount) && trailing.amount > 0
      && TRAILING_UNITS.has(trailing.unit);
    return valid ? undefined : 'trailing interval needs a positive safe integer and supported unit.';
  }
  if (toDate !== undefined) {
    return TO_DATE_GRAINS.has(toDate) ? undefined : 'toDate needs a supported grain coarser than minute.';
  }
  if (cumulative !== true) return 'cumulative must be true.';
  if (!CUMULATIVE_AGGREGATIONS.has(base.aggregation)) {
    return `cannot accumulate ${base.aggregation}; use sum, count, min, or max.`;
  }
  return undefined;
}
