import { assertNoRawSqlUnderJoins } from './sql-under-joins.js';
import type { AnyDatasetInstance, DatasetQuery, MeasureDefinition, TimeGrain, WindowMeasureDefinition } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { GRAIN_FUNCTIONS } from '../constants.js';
import { quoteSQLIdentifier } from '../sql-utils.js';
import { resolveDimensionExpression, resolveFilterField, resolveTenantFilterColumn } from '../query-planner.js';
import { applyRelationshipJoins, buildRelationshipBuilderContext, qualifyBaseColumn } from './relationship-builder-plan.js';
import { getRuntimeTenantPredicate } from './tenant-runtime.js';
import { segmentFilters } from './segments.js';
import { getBaseMeasure, getDerivedMeasure } from './dataset-measures.js';
import { selectedWindowMeasures } from './window-query-measures.js';
import { analyzeWindowTimeAxis } from './window-time-axis.js';
import { validateDatasetQueryInput } from './dataset-query-validation.js';
import { measureToAggregationSpec } from './dataset-normalization.js';
import { applyFilteredAggregationExpression } from './filtered-aggregation-sql.js';
import { derivedProjection } from './derived-measure-sql.js';
import { isCountAggregation, windowAggregateSql } from './window-aggregation-sql.js';

const INTERVAL_FUNCTIONS: Record<TimeGrain, string> = {
  minute: 'Minutes', hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years',
};

function literal(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function add(time: string, amount: string | number, grain: TimeGrain): string {
  return `add${INTERVAL_FUNCTIONS[grain]}(${time}, ${amount})`;
}

function subtract(time: string, amount: number, grain: TimeGrain): string {
  return `subtract${INTERVAL_FUNCTIONS[grain]}(${time}, ${amount})`;
}

/** One row is emitted into each bounded window it contributes to. */
function contributionSql(window: WindowMeasureDefinition | undefined, grain: TimeGrain): string {
  const bucket = `${GRAIN_FUNCTIONS[grain]}(_hq_time)`;
  if (!window) return bucket;
  if (window.cumulative) return `greatest(${bucket}, _hq_first)`;
  let count: string;
  if (window.trailing) count = `dateDiff('${grain}', ${bucket}, ${add(bucket, window.trailing.amount, window.trailing.unit)})`;
  else if (window.toDate) count = `dateDiff('${grain}', ${bucket}, ${add(`${GRAIN_FUNCTIONS[window.toDate]}(_hq_time)`, 1, window.toDate)})`;
  else throw new Error('Window measure has no supported mode.');
  return add(bucket, `arrayJoin(range(toUInt64(${count} + throwIf(${count} > 1000, 'A window row contributes to more than 1000 buckets.'))))`, grain);
}

function scanStart(window: WindowMeasureDefinition, grain: TimeGrain): string {
  if (window.trailing) return subtract(add('_hq_first', 1, grain), window.trailing.amount, window.trailing.unit);
  if (window.toDate) return `${GRAIN_FUNCTIONS[window.toDate]}(_hq_first)`;
  throw new Error('Cumulative windows have unbounded history.');
}

/** ClickHouse lowering for the canonical query-builder path. */
export function buildWindowDatasetSql(
  ds: AnyDatasetInstance,
  query: DatasetQuery,
  options: DatasetQueryExecutionOptions,
): { sql: string; parameters: unknown[]; timeAxisSql: string } {
  const validation = validateDatasetQueryInput(ds, query, options.context);
  if (!validation.valid) throw new Error(`Invalid dataset query: ${validation.errors.join('; ')}`);
  const { axis } = analyzeWindowTimeAxis(ds, query);
  if (!axis || !ds.timeKey) throw new Error('Window measures require a bounded time axis.');
  const windows = selectedWindowMeasures(ds, query);
  const selected = query.measures ?? [];
  const needed = new Set(selected.filter(name => !getDerivedMeasure(ds.measures, name)));
  for (const name of selected) {
    const derived = getDerivedMeasure(ds.measures, name);
    if (derived) Object.values(derived.uses).forEach(input => needed.add(input));
  }
  const baseNames = new Set([...needed].map(name => windows.get(name)?.measure ?? name));
  const bases: { name: string; definition: MeasureDefinition; value: string; arg: string }[] = [];
  const joinCtx = buildRelationshipBuilderContext(ds, query, options.context);
  // Keep source expressions in their own SELECT scope: internal aliases cannot
  // capture authored SQL identifiers, even if a physical column shares a name.
  let raw = applyRelationshipJoins(options.builderFactory.table(ds.source), joinCtx);
  const dims = (query.dimensions ?? []).map((name, i) => ({ name, alias: `_hq_d${i}` }));
  const sourceParts = [resolveDimensionExpression(ds, ds.timeKey, joinCtx)];
  for (const dimension of dims) sourceParts.push(resolveDimensionExpression(ds, dimension.name, joinCtx));
  for (const name of baseNames) {
    const definition = getBaseMeasure(ds.measures, name);
    if (!definition) throw new Error(`Window input "${name}" is not a base measure.`);
    const spec = measureToAggregationSpec(name, definition);
    if (spec.sql) assertNoRawSqlUnderJoins('measure', name, spec.sql, joinCtx);
    const value = `_hq_v${bases.length}`;
    const arg = `_hq_a${bases.length}`;
    bases.push({ name, definition, value, arg });
    sourceParts.push(applyFilteredAggregationExpression(ds, spec, spec.sql ?? resolveDimensionExpression(ds, spec.field, joinCtx), joinCtx));
    sourceParts.push(spec.argField ? resolveDimensionExpression(ds, spec.argField, joinCtx) : 'NULL');
  }
  // A positional tuple isolates internal names from the source table's names.
  const sourceIdentifiers = [...sourceParts, ...Object.keys(ds.dimensions), ...Object.values(ds.dimensions).map(dimension => dimension.sql ?? dimension.column ?? ''), ...Object.values(ds.filters).map(filter => filter.field ?? ''), ds.tenantKey ?? ''];
  let rowAlias = '_hq_row';
  while (sourceIdentifiers.some(text => text.includes(rowAlias))) rowAlias += '_';
  raw = raw.select([`tuple(${sourceParts.join(', ')}) AS ${rowAlias}`]);
  const tenant = getRuntimeTenantPredicate(options.context);
  const tenantColumn = resolveTenantFilterColumn(ds, options.context);
  if (tenant && tenantColumn) raw = raw.where(qualifyBaseColumn(joinCtx, tenantColumn), tenant.operator, tenant.value);
  for (const filter of axis.filters) raw = raw.where(resolveFilterField(ds, filter.field, joinCtx), filter.operator, filter.value);
  for (const filter of segmentFilters(ds, query.segments)) raw = raw.where(resolveDimensionExpression(ds, filter.field, joinCtx), filter.operator, filter.value);
  const { sql: rawSql, parameters } = raw.toSQLWithParams();
  // Preserve DateTime64 fractional values; Date/Date32 use the server timezone.
  const sourceColumns = [`toDateTime64(assumeNotNull(tupleElement(${rowAlias}, 1)), 9) AS _hq_time`];
  dims.forEach((dimension, i) => sourceColumns.push(`tupleElement(${rowAlias}, ${i + 2}) AS ${dimension.alias}`));
  bases.forEach((base, i) => {
    sourceColumns.push(`tupleElement(${rowAlias}, ${dims.length + 2 + i * 2}) AS ${base.value}`);
    sourceColumns.push(`tupleElement(${rowAlias}, ${dims.length + 3 + i * 2}) AS ${base.arg}`);
  });
  const first = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_lower)`;
  const upperBucket = `${GRAIN_FUNCTIONS[axis.grain]}(_hq_upper)`;
  const last = axis.upperInclusive ? upperBucket : `if(_hq_upper = ${upperBucket}, ${subtract(upperBucket, 1, axis.grain)}, ${upperBucket})`;
  const count = `dateDiff('${axis.grain}', _hq_first, _hq_last) + 1`;
  const rangeGuard = `throwIf(_hq_lower > _hq_upper${axis.lowerInclusive && axis.upperInclusive ? '' : ' OR _hq_lower = _hq_upper'}, 'Window measure time range must be non-empty and ordered.')`;
  const guard = axis.resultLimit === undefined ? '0' : `throwIf(${count} > ${axis.resultLimit}, 'Window series exceeds the effective result limit of ${axis.resultLimit} buckets.')`;
  // A zero-row scalar retains the physical timestamp type and timezone.
  // Reading any(time) here would scan the entire population just for its type.
  const ctes = [
    `_hq_raw AS (${rawSql})`,
    `_hq_source AS (SELECT ${sourceColumns.join(', ')} FROM _hq_raw WHERE isNotNull(tupleElement(${rowAlias}, 1)))`,
    `_hq_bounds AS (SELECT parseDateTime64BestEffort(${literal(axis.lower)}, 9, timezoneOf(assumeNotNull((SELECT _hq_time FROM _hq_source LIMIT 0)))) AS _hq_lower, parseDateTime64BestEffort(${literal(axis.upper)}, 9, timezoneOf(assumeNotNull((SELECT _hq_time FROM _hq_source LIMIT 0)))) AS _hq_upper, ${first} AS _hq_first, ${last} AS _hq_last)`,
    `_hq_series AS (SELECT ${add('_hq_first', `arrayJoin(range(toUInt64(${count} + ${guard} + ${rangeGuard})))`, axis.grain)} AS _hq_period FROM _hq_bounds)`,
  ];
  // Always check the singleton axis before aggregating. ClickHouse can skip
  // a series guard when a dimensional CROSS JOIN has an empty population.
  const timeAxisSql = `WITH ${ctes.slice(0, 3).join(',\n')} SELECT ${guard} + ${rangeGuard} AS _hq_validated FROM _hq_bounds`;
  const starts = [...windows.values()].filter(window => !window.cumulative).map(window => scanStart(window, axis.grain));
  // Base measures also need the current buckets when the trailing interval is 1.
  starts.push('_hq_first');
  const lowerScan = [...windows.values()].some(window => window.cumulative) ? '' : ` AND _hq_time >= least(${starts.join(', ')})`;
  ctes.push(`_hq_scanned AS (SELECT * FROM _hq_source CROSS JOIN _hq_bounds WHERE _hq_time < ${add('_hq_last', 1, axis.grain)}${lowerScan})`);
  const keys = dims.map(dimension => dimension.alias);
  ctes.push(`_hq_skeleton AS (SELECT * FROM _hq_series${keys.length ? ` CROSS JOIN (SELECT DISTINCT ${keys.join(', ')} FROM _hq_scanned) AS _hq_combinations` : ''})`);
  const projections = ['s._hq_period AS period', ...dims.map(dimension => `s.${dimension.alias} AS ${quoteSQLIdentifier(dimension.name)}`)];
  const joins: string[] = [];
  let index = 0;
  for (const name of needed) {
    const window = windows.get(name);
    const base = bases.find(base => base.name === (window?.measure ?? name));
    if (!base) throw new Error(`Missing base input for measure "${name}".`);
    const output = `_hq_m${index}`;
    const fan = `_hq_fan${index}`;
    const aggregate = `_hq_agg${index}`;
    const contribution = contributionSql(window, axis.grain);
    const range = window ? '' : ` WHERE _hq_time ${axis.lowerInclusive ? '>=' : '>'} _hq_lower AND _hq_time ${axis.upperInclusive ? '<=' : '<'} _hq_upper`;
    ctes.push(`${fan} AS (SELECT *, ${contribution} AS _hq_period FROM _hq_scanned${range})`);
    // toNullable makes unmatched LEFT JOIN values NULL regardless of join_use_nulls.
    const expression = windowAggregateSql(base.definition, base.value, base.arg);
    ctes.push(`${aggregate} AS (SELECT _hq_period${keys.length ? `, ${keys.join(', ')}` : ''}, toNullable(${expression}) AS ${output} FROM ${fan} WHERE _hq_period BETWEEN _hq_first AND _hq_last${window?.trailing ? ` AND _hq_time >= ${subtract(add('_hq_period', 1, axis.grain), window.trailing.amount, window.trailing.unit)}` : ''} GROUP BY _hq_period${keys.length ? `, ${keys.join(', ')}` : ''})`);
    const alias = `m${index}`;
    const condition = [`s._hq_period = ${alias}._hq_period`, ...keys.map(key => `isNotDistinctFrom(s.${key}, ${alias}.${key})`)];
    joins.push(`LEFT JOIN ${aggregate} AS ${alias} ON ${condition.join(' AND ')}`);
    let value = `${alias}.${output}`;
    if (window?.cumulative) {
      const operation = base.definition.aggregation === 'count' ? 'sum' : base.definition.aggregation;
      value = `${operation}OrNull(${value}) OVER (${keys.length ? `PARTITION BY ${keys.map(key => `s.${key}`).join(', ')} ` : ''}ORDER BY s._hq_period ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`;
    }
    if (isCountAggregation(base.definition)) value = `coalesce(${value}, 0)`;
    projections.push(`${value} AS ${quoteSQLIdentifier(name)}`);
    index++;
  }
  ctes.push(`_hq_values AS (SELECT ${projections.join(', ')} FROM _hq_skeleton AS s ${joins.join(' ')})`);
  const final = [quoteSQLIdentifier('period'), ...dims.map(dimension => quoteSQLIdentifier(dimension.name)), ...selected.map(name => {
    const derived = getDerivedMeasure(ds.measures, name);
    return derived ? derivedProjection(name, derived) : quoteSQLIdentifier(name);
  })];
  // Keep toSQL independently guarded too. This branch produces no valid
  // result rows, and forces axis validation even when _hq_values is empty.
  const outputNames = ['period', ...dims.map(dimension => dimension.name), ...selected];
  ctes.push(`_hq_result AS (SELECT ${final.join(', ')} FROM _hq_values UNION ALL SELECT ${outputNames.map(name => `NULL AS ${quoteSQLIdentifier(name)}`).join(', ')} FROM _hq_bounds WHERE ${guard} + ${rangeGuard} = 1)`);
  let sql = `WITH ${ctes.join(',\n')} SELECT ${outputNames.map(quoteSQLIdentifier).join(', ')} FROM _hq_result`;
  const order = query.orderBy?.length ? query.orderBy : [{ field: 'period', direction: 'asc' }];
  sql += ` ORDER BY ${order.map(item => `${quoteSQLIdentifier(item.field)} ${item.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')}`;
  const limit = options.executionLimit ?? query.limit;
  if (limit !== undefined) sql += ` LIMIT ${limit}`;
  if (query.offset !== undefined) sql += ` OFFSET ${query.offset}`;
  return { sql, parameters, timeAxisSql };
}
