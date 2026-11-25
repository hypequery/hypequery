/**
 * Relationship-qualified fields read by measures' fixed filters.
 *
 * A base measure may narrow its own rows on a to-one relationship's field, e.g.
 * `count(comment_id)` filtered on `response.is_test = false`. That filter names
 * a relationship the query itself never mentions, so join planning, tenant
 * checks and validation must look inside the measures a query computes, not
 * only at its dimensions, filters and ordering.
 */

import { filterLeaves } from './filter-tree.js';
import { baseMeasureNames, getBaseMeasure } from './dataset-measures.js';
import { measureDependencyNames } from './measure-dependencies.js';
import { isQualifiedField, resolveQualifiedField } from './relationship-fields.js';
import type {
  AggregationSpec,
  AnyDatasetInstance,
  DatasetQuery,
  DerivedMetricSpec,
  MeasureFilterNode,
} from '../types.js';

/** A filter's field as the planner reads it: through a declared filter of that name. */
function plannedFilterField(ds: AnyDatasetInstance, field: string): string {
  return Object.hasOwn(ds.filters ?? {}, field) ? ds.filters[field].field : field;
}

/** The relationship-qualified fields one filter tree reads, in order, deduplicated. */
export function qualifiedMeasureFilterFields(
  ds: AnyDatasetInstance,
  filters: readonly MeasureFilterNode[] | undefined,
): string[] {
  const fields = filterLeaves(filters)
    .map(filter => filter.field)
    .filter((field): field is string => typeof field === 'string')
    .map(field => plannedFilterField(ds, field))
    .filter(isQualifiedField);
  return [...new Set(fields)];
}

/**
 * The base measures a selection computes, with every derived, window and shift
 * input expanded. Relationship measures (`<relationship>.<measure>`) are not
 * local, so they contribute nothing here.
 */
function computedBaseMeasures(ds: AnyDatasetInstance, selected: readonly string[]) {
  return measureDependencyNames(ds.measures, selected).flatMap((name) => {
    const definition = getBaseMeasure(ds.measures, name);
    return definition ? [{ name, definition }] : [];
  });
}

/** Relationship-qualified fields read by the fixed filters of the selected measures. */
export function selectedMeasureFilterFields(ds: AnyDatasetInstance, selected: readonly string[]): string[] {
  return [...new Set(computedBaseMeasures(ds, selected)
    .flatMap(({ definition }) => qualifiedMeasureFilterFields(ds, definition.filters)))];
}

/**
 * Relationship-qualified fields read by a dataset query's measures: the
 * selected ones, or every base measure when `measures` is omitted, exactly as
 * the planners select them.
 */
export function datasetQueryMeasureFilterFields(
  ds: AnyDatasetInstance,
  query: Pick<DatasetQuery, 'measures'>,
): string[] {
  return selectedMeasureFilterFields(ds, query.measures ?? baseMeasureNames(ds.measures));
}

/** Relationship-qualified fields read by a metric's aggregate (or a derived metric's inputs). */
export function metricMeasureFilterFields(
  ds: AnyDatasetInstance,
  spec: AggregationSpec | DerivedMetricSpec,
): string[] {
  const filters = spec.__type === 'aggregation_spec'
    ? spec.filters ?? []
    : Object.values(spec.uses).flatMap(input => (
      input.spec.__type === 'aggregation_spec' ? input.spec.filters ?? [] : []
    ));
  return qualifiedMeasureFilterFields(ds, filters);
}

function filterFieldErrors(ds: AnyDatasetInstance, owner: string, fields: readonly string[]): string[] {
  return fields.flatMap((field) => {
    const resolution = resolveQualifiedField(ds, field);
    return resolution?.error ? [`${owner} filter on "${field}": ${resolution.error}`] : [];
  });
}

/**
 * Why a selection's relationship measure filters cannot be planned: each must
 * name one hop over a to-one relationship (`belongsTo` / `hasOne`) and a
 * column-backed dimension of its target, the same rule a query's own
 * relationship fields follow.
 */
export function selectedMeasureFilterErrors(ds: AnyDatasetInstance, selected: readonly string[]): string[] {
  return computedBaseMeasures(ds, selected).flatMap(({ name, definition }) => (
    filterFieldErrors(ds, `Measure "${name}"`, qualifiedMeasureFilterFields(ds, definition.filters))
  ));
}

/** {@link selectedMeasureFilterErrors} for a metric's aggregate or its derived inputs. */
export function metricMeasureFilterErrors(
  ds: AnyDatasetInstance,
  name: string,
  spec: AggregationSpec | DerivedMetricSpec,
): string[] {
  if (spec.__type === 'aggregation_spec') {
    return filterFieldErrors(ds, `Metric "${name}"`, qualifiedMeasureFilterFields(ds, spec.filters));
  }
  return Object.entries(spec.uses).flatMap(([alias, input]) => (
    input.spec.__type === 'aggregation_spec'
      ? filterFieldErrors(ds, `Metric "${name}" input "${alias}"`, qualifiedMeasureFilterFields(ds, input.spec.filters))
      : []
  ));
}
