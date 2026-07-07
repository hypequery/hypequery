import type {
  AggregationSpec,
  AnyDatasetInstance,
  DerivedMetricConfig,
} from '../types.js';
import { validateFilterValue } from '../validation.js';

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

  for (const filter of spec.filters ?? []) {
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
