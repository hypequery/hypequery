import { filterLeaves } from './filter-tree.js';
import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricConfig,
  MetricFilter,
} from '../types.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';
import { validateFilterValue } from '../validation.js';
import { validatePercentileLevel } from '../measure.js';
import { assertAggregateStateFunction } from './aggregate-state-functions.js';

const NUMERIC_FIELD_TYPES = new Set(['number']);

// Aggregations whose output tracks the input field's type, so a metric
// (contract valueType: 'number') needs a numeric input dimension.
const NUMERIC_INPUT_AGGREGATIONS = new Set([
  'sum', 'avg', 'percentile', 'stddev', 'variance', 'argMax', 'argMin',
]);

export function validateBaseMetric(
  ds: AnyDatasetInstance,
  metricName: string,
  spec: AggregationSpec,
  options?: { allowHiddenField?: boolean },
): void {
  if (spec.aggregation === 'argMax' || spec.aggregation === 'argMin') {
    if (typeof spec.argField !== 'string' || spec.argField.trim().length === 0) {
      throw new Error(
        `Invalid metric "${metricName}": ${spec.aggregation}() requires a non-empty argField ("by" column).`,
      );
    }
    if (spec.filters?.length) {
      throw new Error(`Invalid metric "${metricName}": measure filters are not supported on ${spec.aggregation} aggregations.`);
    }
  }

  if (spec.aggregation === 'merge') {
    assertAggregateStateFunction(spec.stateFunction, `Invalid metric "${metricName}":`);
    if (spec.filters?.length) {
      throw new Error(`Invalid metric "${metricName}": measure filters are not supported on merge aggregations.`);
    }
  }

  if (spec.aggregation === 'percentile') {
    if (spec.level == null) {
      throw new Error(`Invalid metric "${metricName}": percentile() requires a level.`);
    }
    validatePercentileLevel(spec.level);
  }

  const dimension = ds.dimensions[spec.field];
  if (!dimension && !options?.allowHiddenField) {
    throw new Error(
      `Invalid metric "${metricName}": dimension "${spec.field}" does not exist on dataset "${ds.name}".`,
    );
  }

  if (
    dimension &&
    NUMERIC_INPUT_AGGREGATIONS.has(spec.aggregation) &&
    !NUMERIC_FIELD_TYPES.has(dimension.fieldType)
  ) {
    throw new Error(
      `Invalid metric "${metricName}": ${spec.aggregation}() requires a numeric dimension, but "${spec.field}" is ${dimension.fieldType}.`,
    );
  }

  for (const filter of filterLeaves(spec.filters)) {
    if (isQualifiedField(filter.field)) {
      validateQualifiedMetricFilter(ds, metricName, filter);
      continue;
    }
    const filterDefinition = ds.filters[filter.field];
    const resolvedField = filterDefinition?.field ?? filter.field;
    const fieldType = ds.dimensions[resolvedField]?.fieldType;

    if (!fieldType) {
      throw new Error(
        `Invalid metric "${metricName}": measure filter field "${filter.field}" does not exist on dataset "${ds.name}".`,
      );
    }

    if (filterDefinition?.operators && !filterDefinition.operators.includes(filter.operator)) {
      throw new Error(
        `Invalid metric "${metricName}": measure filter "${filter.field}" does not allow operator "${filter.operator}".`,
      );
    }

    const filterError = validateFilterValue(filter, fieldType);
    if (filterError) {
      throw new Error(`Invalid metric "${metricName}": ${filterError}`);
    }
  }
}

/**
 * A measure filter on `<relationship>.<field>` (K-17) reads a to-one target's
 * dimension through the join the planner adds for it. A target that is not
 * defined yet (a relationship thunk read before its dataset's declaration)
 * is left to query-time validation, which reports the same errors.
 */
function validateQualifiedMetricFilter(ds: AnyDatasetInstance, metricName: string, filter: MetricFilter): void {
  let resolution: ReturnType<typeof resolveQualifiedField>;
  try {
    resolution = resolveQualifiedField(ds, filter.field);
  } catch (error) {
    if (error instanceof ReferenceError) return;
    throw error;
  }
  if (!resolution) return;
  if (!resolution.resolved) {
    throw new Error(`Invalid metric "${metricName}": measure filter field "${filter.field}": ${resolution.error}`);
  }
  const filterError = validateFilterValue(filter, resolution.resolved.targetDimension.fieldType);
  if (filterError) {
    throw new Error(`Invalid metric "${metricName}": ${filterError}`);
  }
}

export function validateDerivedMetric(
  ds: AnyDatasetInstance,
  metricName: string,
  config: DerivedMetricConfig<string>,
): void {
  const usedMetrics = Object.entries(config.uses);
  if (usedMetrics.length === 0) {
    throw new Error(`Invalid metric "${metricName}": derived metrics must reference at least one base metric.`);
  }

  for (const [alias, metric] of usedMetrics) {
    if (metric.datasetName !== ds.name) {
      throw new Error(
        `Invalid metric "${metricName}": referenced metric "${alias}" belongs to dataset "${metric.datasetName}", expected "${ds.name}".`,
      );
    }

    if (metric.spec.__type !== 'aggregation_spec') {
      throw new Error(
        `Invalid metric "${metricName}": referenced metric "${alias}" must be a base aggregation on dataset "${ds.name}".`,
      );
    }
  }
}
