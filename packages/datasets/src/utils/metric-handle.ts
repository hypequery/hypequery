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

export type MetricHandle = MetricRef | GrainedMetricRef;

export function isMetricHandle(value: unknown): value is MetricHandle {
  return typeof value === 'object'
    && value !== null
    && '__type' in value
    && (
      (value as { __type?: string }).__type === 'metric_ref'
      || (value as { __type?: string }).__type === 'grained_metric_ref'
    );
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
