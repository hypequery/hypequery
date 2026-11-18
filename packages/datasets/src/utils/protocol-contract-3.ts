/**
 * The contract 3 parts of a published dataset (RFC 0015): segments, window and
 * shift measures, and the `approximate` marker on derived measures.
 *
 * Producers follow the lowest-version rule: a deployment is contract 3 only
 * when one of its datasets uses a feature contract 2 cannot express, so every
 * other deployment keeps its contract 2 bytes and identity. Python's builder
 * (`hypequery.datasets.deployment`) emits the same contract for the same
 * definition; `specs/datasets/contract-3-authoring-v1.json` pins both.
 */

import {
  parseProtocolIdentifier,
  type ProtocolDatasetSegment,
  type ProtocolDatasetShiftMeasure,
  type ProtocolDatasetWindowMeasure,
  type ProtocolExpression,
} from '@hypequery/protocol';
import type {
  AnyDatasetInstance,
  ShiftMeasureDefinition,
  WindowMeasureDefinition,
} from '../types.js';
import { isApproximateBaseMeasure, isApproximateMeasure } from './approximate-measures.js';
import { byName } from './by-name.js';
import { splitDatasetMeasures } from './dataset-measures.js';
import { isSubDayTimeGrain } from './portable-grains.js';
import { filterExpression } from './protocol-metric-expressions.js';
import { toProtocolSemanticMetadata } from './protocol-semantic-metadata.js';

/** The contract 3 features `dataset` uses, by name, in a fixed order. */
export function contract3Features(dataset: AnyDatasetInstance): string[] {
  const { base, windows, shifts } = splitDatasetMeasures(dataset.measures);
  return [
    ...(Object.keys(dataset.segments ?? {}).length > 0 ? ['segments'] : []),
    ...(Object.keys(windows).length > 0 ? ['window measures'] : []),
    ...(Object.keys(shifts).length > 0 ? ['shift measures'] : []),
    ...(Object.values(base).some(measure => measure.aggregation === 'approxCountDistinct')
      ? ['approxCountDistinct'] : []),
    ...(dataset.defaults?.timeGrain !== undefined && isSubDayTimeGrain(dataset.defaults.timeGrain)
      ? ['a sub-day default grain'] : []),
  ];
}

/** True when the deployment holding `dataset` must be contract 3. */
export function usesContract3Features(dataset: AnyDatasetInstance): boolean {
  return contract3Features(dataset).length > 0;
}

/**
 * Segments as contract predicates, sorted by name. One condition is a bare
 * comparison; several are the `and` of their comparisons in authored order.
 */
export function protocolSegments(dataset: AnyDatasetInstance): ProtocolDatasetSegment[] {
  return Object.entries(dataset.segments ?? {}).map(([name, segment]) => {
    const conditions = segment.filters.map(filterExpression);
    const predicate: ProtocolExpression = conditions.length === 1
      ? conditions[0]!
      : { kind: 'logical', operator: 'and', operands: conditions };
    return {
      name: parseProtocolIdentifier(name),
      predicate,
      ...(segment.label !== undefined ? { label: segment.label } : {}),
      ...(segment.description !== undefined ? { description: segment.description } : {}),
    };
  }).sort(byName);
}

type TimeMeasureDefinition = WindowMeasureDefinition | ShiftMeasureDefinition;
type ProtocolTimeMeasure = ProtocolDatasetWindowMeasure | ProtocolDatasetShiftMeasure;

function timeMeasure(
  dataset: AnyDatasetInstance,
  name: string,
  definition: TimeMeasureDefinition,
): ProtocolTimeMeasure {
  const wrapped = dataset.measures[definition.measure];
  const approximate = wrapped?.__type === 'measure_definition' && isApproximateBaseMeasure(wrapped);
  const common = {
    name: parseProtocolIdentifier(name),
    measure: parseProtocolIdentifier(definition.measure),
    requiresTimeRange: true as const,
    ...(approximate ? { approximate: true as const } : {}),
    ...(definition.label !== undefined ? { label: definition.label } : {}),
    ...(definition.description !== undefined ? { description: definition.description } : {}),
    ...toProtocolSemanticMetadata(definition),
  };
  if (definition.__type === 'shift_measure_definition') {
    return {
      kind: 'shift',
      ...common,
      interval: { amount: definition.interval.amount, unit: definition.interval.unit },
    } as ProtocolDatasetShiftMeasure;
  }
  return {
    kind: 'window',
    ...common,
    ...(definition.trailing !== undefined
      ? { trailing: { amount: definition.trailing.amount, unit: definition.trailing.unit } }
      : {}),
    ...(definition.toDate !== undefined ? { toDate: definition.toDate } : {}),
    ...(definition.cumulative === true ? { cumulative: true as const } : {}),
  } as ProtocolDatasetWindowMeasure;
}

/** Window and shift measures in the order the dataset declares them. */
export function protocolTimeMeasures(dataset: AnyDatasetInstance): ProtocolTimeMeasure[] {
  return Object.entries(dataset.measures)
    .filter((entry): entry is [string, TimeMeasureDefinition] => (
      entry[1].__type === 'window_measure_definition' || entry[1].__type === 'shift_measure_definition'
    ))
    .map(([name, definition]) => timeMeasure(dataset, name, definition));
}

/** The `approximate` marker for a derived measure: set when any input is approximate. */
export function derivedApproximateMarker(
  dataset: AnyDatasetInstance,
  name: string,
): { readonly approximate?: true } {
  return isApproximateMeasure(dataset.measures, name) ? { approximate: true } : {};
}
