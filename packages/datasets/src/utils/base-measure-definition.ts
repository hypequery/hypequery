import type {
  DerivedMeasureDefinition,
  DerivedMeasureOptions,
  DerivedMeasureUses,
  MeasureDefinition,
  MeasureOptions,
  MeasureAggregation,
} from '../types.js';
import { snapshotSemanticMetadata } from './semantic-metadata.js';

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
