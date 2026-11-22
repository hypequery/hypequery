import type { AnyDatasetInstance, DatasetFilterNode, MetricFilter } from '../types.js';
import { applyFilterTree } from './filter-predicate-tree.js';
import type { QueryTimePredicate } from './query-timezone.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { resolveDimensionExpression, resolveFilterField } from '../query-planner.js';
import { buildRelationshipBuilderContext, type RelationshipBuilderContext } from './relationship-builder-plan.js';
import { queryTimeFilter, queryTimeSql } from './query-timezone.js';
import { scopedDatasetSource } from './scoped-dataset-source.js';
import type { StatementParameters } from './statement-parameters.js';

/** What an event scan projects, and the aliases later stages read. */
export interface EventSourceRequest {
  readonly entity: string;
  readonly breakdown: readonly string[];
  /** Filter names that step, start or return conditions test. */
  readonly conditionFields: readonly string[];
  /** Every caller filter, including the time range; groups allowed (RFC 0029). */
  readonly filters: readonly DatasetFilterNode[];
  readonly timezone?: string;
}

export interface EventSourceSql {
  /** `_hq_raw` and `_hq_events`. */
  readonly ctes: readonly string[];
  /** `_hq_b0`, `_hq_b1`, … in breakdown order. */
  readonly breakdown: readonly string[];
  /** Condition field name -> its projected alias. */
  readonly conditionColumn: (field: string) => string;
  /** One condition as predicates over its projected alias, as a caller filter on that field. */
  readonly conditionPredicates: (condition: MetricFilter) => readonly QueryTimePredicate[];
  readonly joinCtx: RelationshipBuilderContext | undefined;
}

/**
 * The event rows an RFC 0027 operation reads: the dataset's source with every
 * trusted restriction applied (tenancy, row policies, enforced constraints,
 * `FINAL`), the caller's filters, and only the columns the operation needs.
 *
 * Authored expressions stay inside their own SELECT and come out as one
 * positional tuple, so internal aliases can't capture a source column name.
 * `_hq_events` has `_hq_time` (in the query zone), `_hq_entity`, the
 * breakdown aliases and the condition aliases.
 */
export function buildEventSourceSql(
  ds: AnyDatasetInstance,
  request: EventSourceRequest,
  options: DatasetQueryExecutionOptions,
  statement: StatementParameters,
): EventSourceSql {
  const { dialect } = statement;
  if (!ds.timeKey) throw new Error(`Dataset "${ds.name}" has no time key for events.`);
  const joinCtx = buildRelationshipBuilderContext(ds, {
    dimensions: [request.entity, ...request.breakdown],
    filters: [...request.filters],
  }, options.context, dialect);
  let raw = scopedDatasetSource({
    builderFactory: options.builderFactory, ds, context: options.context, joinCtx, dialect, timezone: request.timezone,
  });
  const parts = [
    resolveDimensionExpression(ds, ds.timeKey, joinCtx),
    resolveDimensionExpression(ds, request.entity, joinCtx),
    ...request.breakdown.map(name => resolveDimensionExpression(ds, name, joinCtx)),
    ...request.conditionFields.map(name => resolveFilterField(ds, name, joinCtx)),
  ];
  const identifiers = [
    ...parts,
    ...Object.keys(ds.dimensions),
    ...Object.values(ds.dimensions).map(dimension => dimension.sql ?? dimension.column ?? ''),
    ...Object.values(ds.filters).map(filter => filter.field ?? ''),
    ds.tenantKey ?? '',
  ];
  let rowAlias = '_hq_row';
  while (identifiers.some(text => text.includes(rowAlias))) rowAlias += '_';
  raw = raw.select([`${dialect.packRow(parts)} AS ${rowAlias}`]);
  raw = applyFilterTree(raw, request.filters, filter => (
    queryTimeFilter(dialect, ds, filter as MetricFilter, resolveFilterField(ds, filter.field, joinCtx), request.timezone)
  ));

  const breakdown = request.breakdown.map((_, index) => `_hq_b${index}`);
  const conditionAliases = new Map(request.conditionFields.map((name, index) => [name, `_hq_f${index}`]));
  const element = (position: number) => dialect.rowElement(rowAlias, position);
  const columns = [
    `${queryTimeSql(dialect, dialect.assumeNotNull(element(1)), request.timezone)} AS _hq_time`,
    `${element(2)} AS _hq_entity`,
    ...breakdown.map((alias, index) => `${element(3 + index)} AS ${alias}`),
    ...request.conditionFields.map((name, index) => (
      `${element(3 + breakdown.length + index)} AS ${conditionAliases.get(name)!}`
    )),
  ];
  const conditionColumn = (field: string) => {
    const alias = conditionAliases.get(field);
    if (!alias) throw new Error(`Condition field "${field}" was not projected.`);
    return alias;
  };
  return {
    ctes: [
      `_hq_raw AS (${statement.embedBuilder(raw)})`,
      // An event with no time or no entity can't be placed in a sequence.
      `_hq_events AS (SELECT ${columns.join(', ')} FROM _hq_raw WHERE ${dialect.isNotNull(element(1))} AND ${dialect.isNotNull(element(2))})`,
    ],
    breakdown,
    conditionColumn,
    conditionPredicates: condition => queryTimeFilter(
      dialect, ds, condition, conditionColumn(condition.field), request.timezone,
    ),
    joinCtx,
  };
}
