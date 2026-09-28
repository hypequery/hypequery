import type { AnyDatasetInstance, DatasetQuery, MeasureDefinition, MetricFilter } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { resolveDimensionExpression, resolveFilterField, resolveTenantFilterColumn } from '../query-planner.js';
import { applyRelationshipJoins, buildRelationshipBuilderContext, qualifyBaseColumn } from './relationship-builder-plan.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import { segmentFilters } from './segments.js';
import { getBaseMeasure } from './dataset-measures.js';
import { measureToAggregationSpec } from './dataset-normalization.js';
import { applyFilteredAggregationExpression } from './filtered-aggregation-sql.js';
import { assertNoRawSqlUnderJoins } from './sql-under-joins.js';

export interface TimeMeasureSqlDimension {
  name: string;
  alias: string;
}

export interface TimeMeasureSqlBase {
  name: string;
  definition: MeasureDefinition;
  value: string;
  arg: string;
}

export interface TimeMeasureSqlSource {
  ctes: string[];
  parameters: unknown[];
  dimensions: TimeMeasureSqlDimension[];
  bases: TimeMeasureSqlBase[];
  rowAlias: string;
}

/** Isolate authored expressions, joins, tenancy and filters from internal SQL aliases. */
export function buildTimeMeasureSourceSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  baseNames: Iterable<string>,
  filters: readonly MetricFilter[],
  options: DatasetQueryExecutionOptions,
): TimeMeasureSqlSource {
  const bases: TimeMeasureSqlBase[] = [];
  const joinCtx = buildRelationshipBuilderContext(ds, query, options.context);
  // Keep source expressions in their own SELECT scope: internal aliases cannot
  // capture authored SQL identifiers, even if a physical column shares a name.
  let raw = applyRelationshipJoins(options.builderFactory.table(ds.source), joinCtx);
  const dims = (query.dimensions ?? []).map((name, i) => ({ name, alias: `_hq_d${i}` }));
  const sourceParts = [resolveDimensionExpression(ds, ds.timeKey!, joinCtx)];
  for (const dimension of dims) sourceParts.push(resolveDimensionExpression(ds, dimension.name, joinCtx));
  for (const name of baseNames) {
    const definition = getBaseMeasure(ds.measures, name);
    if (!definition) throw new Error(`Window input "${name}" is not a base measure.`);
    const spec = measureToAggregationSpec(name, definition);
    if (spec.sql) assertNoRawSqlUnderJoins('measure', name, spec.sql, joinCtx);
    const value = `_hq_v${bases.length}`;
    const arg = `_hq_a${bases.length}`;
    bases.push({ name, definition, value, arg });
    const expression = spec.sql ?? resolveDimensionExpression(ds, spec.field, joinCtx);
    sourceParts.push(applyFilteredAggregationExpression(ds, spec, expression, joinCtx));
    sourceParts.push(spec.argField ? resolveDimensionExpression(ds, spec.argField, joinCtx) : 'NULL');
  }
  // A positional tuple isolates internal names from the source table's names.
  const sourceIdentifiers = [
    ...sourceParts,
    ...Object.keys(ds.dimensions),
    ...Object.values(ds.dimensions).map(dimension => dimension.sql ?? dimension.column ?? ''),
    ...Object.values(ds.filters).map(filter => filter.field ?? ''),
    ds.tenantKey ?? '',
  ];
  let rowAlias = '_hq_row';
  while (sourceIdentifiers.some(text => text.includes(rowAlias))) rowAlias += '_';
  raw = raw.select([`tuple(${sourceParts.join(', ')}) AS ${rowAlias}`]);
  const tenant = getRuntimeTenantPredicate(options.context);
  const tenantColumn = resolveTenantFilterColumn(ds, options.context);
  if (tenant && tenantColumn) raw = raw.where(qualifyBaseColumn(joinCtx, tenantColumn), tenant.operator, tenant.value);
  for (const filter of filters) {
    raw = raw.where(resolveFilterField(ds, filter.field, joinCtx), filter.operator, filter.value);
  }
  for (const filter of segmentFilters(ds, query.segments)) {
    raw = raw.where(resolveDimensionExpression(ds, filter.field, joinCtx), filter.operator, filter.value);
  }
  const { sql: rawSql, parameters } = raw.toSQLWithParams();
  // Preserve DateTime64 fractional values; Date/Date32 use the server timezone.
  const sourceColumns = [`toDateTime64(assumeNotNull(tupleElement(${rowAlias}, 1)), 9) AS _hq_time`];
  dims.forEach((dimension, i) => sourceColumns.push(`tupleElement(${rowAlias}, ${i + 2}) AS ${dimension.alias}`));
  bases.forEach((base, i) => {
    const valuePosition = dims.length + 2 + i * 2;
    sourceColumns.push(`tupleElement(${rowAlias}, ${valuePosition}) AS ${base.value}`);
    sourceColumns.push(`tupleElement(${rowAlias}, ${valuePosition + 1}) AS ${base.arg}`);
  });
  return {
    ctes: [
      `_hq_raw AS (${rawSql})`,
      `_hq_source AS (SELECT ${sourceColumns.join(', ')} FROM _hq_raw WHERE isNotNull(tupleElement(${rowAlias}, 1)))`,
    ],
    parameters,
    dimensions: dims,
    bases,
    rowAlias,
  };
}
