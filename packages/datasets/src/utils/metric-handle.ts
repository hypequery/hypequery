import type {
  AnyDatasetInstance,
  ExecutionContext,
  GrainedMetricRef,
  MetricFilter,
  MetricQuery,
  MetricRef,
  TimeGrain,
} from '../types.js';
import { resolveDimensionExpression, resolveFilterField, resolveTenantFilterColumn } from '../query-planner.js';
type DatasetShape = AnyDatasetInstance;

function isMetricHandleType(value: unknown): value is 'metric_ref' | 'grained_metric_ref' {
  return value === 'metric_ref' || value === 'grained_metric_ref';
}

export type MetricHandle = MetricRef | GrainedMetricRef;

export function isMetricHandle(value: unknown): value is MetricHandle {
  return typeof value === 'object'
    && value !== null
    && '__type' in value
    && isMetricHandleType(value.__type);
}

export function assertMetricHandle(value: unknown): asserts value is MetricHandle {
  if (!isMetricHandle(value)) {
    throw new Error(
      'MetricExecutor only supports MetricRef and GrainedMetricRef. ' +
      'dataset.query(...) is not part of the public execution API.',
    );
  }
}

export function getMetricRef(metric: MetricHandle): MetricRef {
  return metric.__type === 'grained_metric_ref' ? metric.metric : metric;
}

export function getMetricGrain(metric: MetricHandle, query: MetricQuery): TimeGrain | undefined {
  return metric.__type === 'grained_metric_ref' ? metric.grain : query.by ?? undefined;
}

export function getTenantRuntimeColumn(
  ds: DatasetShape,
  context?: ExecutionContext,
): string | undefined {
  if (!context?.runtime?.tenant?.id) {
    return undefined;
  }

  return resolveTenantFilterColumn(ds, context);
}

export function isTenantScopedFilter(
  ds: DatasetShape,
  filter: MetricFilter,
  context?: ExecutionContext,
): boolean {
  const tenantColumn = getTenantRuntimeColumn(ds, context);
  if (!tenantColumn) {
    return false;
  }

  return resolveFilterField(ds, filter.field) === resolveDimensionExpression(ds, tenantColumn);
}
