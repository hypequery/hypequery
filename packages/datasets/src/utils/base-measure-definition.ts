import type {
  DerivedMeasureDefinition,
  DerivedMeasureOptions,
  DerivedMeasureUses,
  MeasureDefinition,
  MeasureOptions,
  MeasureAggregation,
} from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';
import { assertAggregateStateFunction, type AggregateStateFunction } from './aggregate-state-functions.js';

export function createMeasureHelper<TAggregation extends MeasureAggregation>(aggregation: TAggregation) {
  return <const TField extends string, const TOptions extends MeasureOptions = MeasureOptions>(field: TField, opts?: TOptions): MeasureDefinition & { aggregation: TAggregation; field: TField } & TOptions => ({
    __type: 'measure_definition',
    aggregation,
    field,
    sql: opts?.sql,
    dependencies: opts?.dependencies,
    label: opts?.label,
    description: opts?.description,
    ...snapshotSemanticMetadata(opts ?? {}),
    filters: opts?.filters,
  }) as MeasureDefinition & { aggregation: TAggregation; field: TField } & TOptions;
}

export function validatePercentileLevel(level: number): void {
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) {
    throw new Error(`Invalid percentile level ${level}: expected a number between 0 and 1.`);
  }
}

export function createArgMeasureHelper<TAggregation extends 'argMax' | 'argMin'>(aggregation: TAggregation) {
  return <const TField extends string, const TArg extends string, const TOptions extends Omit<MeasureOptions, 'filters'> = Omit<MeasureOptions, 'filters'>>(field: TField, by: TArg, opts?: TOptions & { filters?: never }): MeasureDefinition & { aggregation: TAggregation; field: TField; argField: TArg } & TOptions => {
    if (typeof by !== 'string' || by.trim().length === 0) {
      throw new Error(`measure.${aggregation}("${field}", by) requires a "by" field.`);
    }
    return {
      __type: 'measure_definition',
      aggregation,
      field,
      argField: by,
      sql: opts?.sql,
      dependencies: opts?.dependencies,
      label: opts?.label,
      description: opts?.description,
      ...snapshotSemanticMetadata(opts ?? {}),
    } as MeasureDefinition & { aggregation: TAggregation; field: TField; argField: TArg } & TOptions;
  };
}

export function createPercentileMeasure<const TField extends string, const TOptions extends MeasureOptions = MeasureOptions>(field: TField, level: number, opts?: TOptions): MeasureDefinition & { aggregation: 'percentile'; field: TField } & TOptions {
  validatePercentileLevel(level);
  return {
    __type: 'measure_definition',
    aggregation: 'percentile',
    field,
    level,
    sql: opts?.sql,
    dependencies: opts?.dependencies,
    label: opts?.label,
    description: opts?.description,
    ...snapshotSemanticMetadata(opts ?? {}),
    filters: opts?.filters,
  } as MeasureDefinition & { aggregation: 'percentile'; field: TField } & TOptions;
}

/**
 * Finalizes the aggregate states stored in `field` (an `AggregateFunction`
 * column) with `stateFunction`'s `-Merge` combinator. Measure filters are not
 * supported: a filtered merge needs `-MergeIf`, which this measure does not
 * emit yet.
 */
export function createMergeMeasure<
  const TStateFunction extends AggregateStateFunction,
  const TField extends string,
  const TOptions extends Omit<MeasureOptions, 'filters' | 'sql' | 'dependencies'> = Omit<MeasureOptions, 'filters' | 'sql' | 'dependencies'>,
>(
  stateFunction: TStateFunction,
  field: TField,
  opts?: TOptions & { filters?: never; sql?: never; dependencies?: never },
): MeasureDefinition & { aggregation: 'merge'; field: TField; stateFunction: TStateFunction } & TOptions {
  assertAggregateStateFunction(stateFunction, `measure.merge(…, "${field}")`);
  if (typeof field !== 'string' || field.trim().length === 0) {
    throw new Error('measure.merge(stateFunction, field) requires a field.');
  }
  return {
    __type: 'measure_definition',
    aggregation: 'merge',
    field,
    stateFunction,
    label: opts?.label,
    description: opts?.description,
    ...snapshotSemanticMetadata(opts ?? {}),
  } as MeasureDefinition & { aggregation: 'merge'; field: TField; stateFunction: TStateFunction } & TOptions;
}

export function createMedianMeasure<const TField extends string, const TOptions extends MeasureOptions = MeasureOptions>(field: TField, opts?: TOptions) {
  return createPercentileMeasure(field, 0.5, opts);
}

export function createDerivedMeasure<const TUses extends DerivedMeasureUses>(
  options: DerivedMeasureOptions<TUses>,
): DerivedMeasureDefinition<TUses> {
  return {
    __type: 'derived_measure_definition',
    uses: { ...options.uses },
    formula: options.formula,
    label: options.label,
    description: options.description,
    ...snapshotSemanticMetadata(options),
  };
}
