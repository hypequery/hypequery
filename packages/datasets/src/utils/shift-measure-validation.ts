import type { DatasetMeasureDefinition } from '../types.js';
import { isSafeSQLIdentifier } from '../sql-utils.js';
import { isSupportedTimeGrain } from '../constants.js';
import { isShiftMeasure } from './dataset-measures.js';

export function validateShiftMeasures(datasetName: string, timeKey: string | undefined, measures: Record<string, DatasetMeasureDefinition>): void {
  for (const [name, definition] of Object.entries(measures)) {
    if (!isShiftMeasure(definition)) continue;
    const prefix = `Invalid dataset "${datasetName}": shift measure "${name}"`;
    if (!isSafeSQLIdentifier(name)) throw new Error(`${prefix} name is not a safe identifier.`);
    if (!timeKey) throw new Error(`${prefix} requires a timeKey.`);
    if (!Object.hasOwn(measures, definition.measure)) throw new Error(`${prefix} references missing measure "${String(definition.measure)}".`);
    const interval = definition.interval;
    if (!interval || !Number.isSafeInteger(interval.amount) || interval.amount <= 0 || !isSupportedTimeGrain(interval.unit)) {
      throw new Error(`${prefix} interval needs a positive safe integer and supported unit.`);
    }
  }
}
