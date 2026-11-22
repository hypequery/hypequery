import type { AnyDatasetInstance } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import { assertRawSqlForDialect } from './raw-sql-dialect-check.js';
import { StatementParameters, type PlannedStatement } from './statement-parameters.js';
import { buildEventSourceSql } from './event-source-sql.js';
import { eventConditionFlagSql } from './event-condition-sql.js';
import { rankedBreakdownSql } from './event-breakdown-sql.js';
import type { FunnelSpec } from './event-operation-spec.js';

/** A planned funnel and what its rows mean. */
export interface PlannedFunnel {
  readonly statement: PlannedStatement;
  readonly breakdown: readonly string[];
  readonly readsFinal: boolean;
}

/**
 * The `strict` level: the deepest step reached by a chain of strictly later
 * events whose last is within the window of its first.
 *
 * `windowFunnel(…, 'strict_increase')` alone is wrong when events share a
 * timestamp: whether a chain survives depends on the order it reads ties in.
 * Each event is therefore split into one row per step it satisfies, the rows
 * are ordered by `time × (N + 1) + (N − step)`, and the window is scaled by
 * `N + 1`. Higher steps at one instant then sort first, so an event can only
 * extend a chain whose previous event is strictly earlier, and the window
 * check is exact because the offset is smaller than one scaled millisecond.
 */
function strictLevelSql(steps: number, windowMs: number): { arrayJoin: string; level: string } {
  const scale = steps + 1;
  const conditions = Array.from({ length: steps }, (_, index) => `_hq_j = ${index + 1}`).join(', ');
  return {
    arrayJoin: `ARRAY JOIN arrayFilter(_hq_k -> _hq_steps[_hq_k] = 1, range(1, ${steps + 1})) AS _hq_j`,
    level: `windowFunnel(${windowMs * scale}, 'strict_increase')(`
      + `toUInt64(toUnixTimestamp64Milli(_hq_time) * ${scale} + (${steps} - _hq_j)), ${conditions}) AS _hq_level`,
  };
}

/**
 * The `any` level: the largest k such that steps 1…k each have a matching
 * event within one span of `window`, in any order. Every matching timestamp
 * is tried as the span's start; the earliest event of a satisfying span is
 * one of them, so the search is exact.
 */
function anyLevelSql(steps: number, windowMs: number): { arrays: string[]; level: string } {
  const arrays = Array.from({ length: steps }, (_, index) => (
    `groupArrayIf(toUnixTimestamp64Milli(_hq_time), _hq_steps[${index + 1}] = 1) AS _hq_s${index + 1}`
  ));
  let prefix = String(steps);
  for (let step = steps; step >= 1; step -= 1) {
    prefix = `if(arrayExists(_hq_x -> _hq_x >= _hq_t AND _hq_x <= _hq_t + ${windowMs}, _hq_s${step}), ${prefix}, ${step - 1})`;
  }
  const anchors = `arrayConcat(${Array.from({ length: steps }, (_, index) => `_hq_s${index + 1}`).join(', ')})`;
  return { arrays, level: `arrayMax(arrayMap(_hq_t -> ${prefix}, ${anchors})) AS _hq_level` };
}

/**
 * Plan a funnel (RFC 0027) as one statement: scan → per-entity level →
 * per-group counts of entities reaching each step → ranked breakdown groups.
 * The caller expands each returned row into one row per step.
 */
export function buildFunnelSql(
  ds: AnyDatasetInstance,
  spec: FunnelSpec,
  options: DatasetQueryExecutionOptions,
  readsFinal: (joinCtx: ReturnType<typeof buildEventSourceSql>['joinCtx']) => boolean,
): PlannedFunnel {
  const dialect = resolveDatasetSqlDialect(options.builderFactory);
  if (dialect.name !== 'clickhouse') {
    throw new Error(`Funnels need ClickHouse; the "${dialect.name}" datasets dialect has no equivalent yet.`);
  }
  assertRawSqlForDialect(ds, dialect);
  const statement = new StatementParameters(dialect);
  const conditionFields = [...new Set(spec.steps.flatMap(step => step.where.map(condition => condition.field)))];
  const source = buildEventSourceSql(ds, {
    entity: spec.entity,
    breakdown: spec.breakdown,
    conditionFields,
    filters: spec.filters,
    ...(spec.timezone === undefined ? {} : { timezone: spec.timezone }),
  }, options, statement);
  const breakdown = source.breakdown;
  const steps = spec.steps.length;
  const flags = spec.steps.map(step => eventConditionFlagSql(step.where, source.conditionColumn, statement));
  const partition = ['_hq_entity', ...breakdown].join(', ');
  // Only events that satisfy some step can move an entity through the funnel.
  const flagged = `_hq_flagged AS (SELECT _hq_time, ${partition}, [${flags.join(', ')}] AS _hq_steps `
    + 'FROM _hq_events WHERE has(_hq_steps, 1))';

  const cohort = spec.by === undefined ? [] : ['_hq_first'];
  let entities: string;
  if (spec.order === 'any') {
    const any = anyLevelSql(steps, spec.windowMs);
    const first = spec.by === undefined ? [] : ['minIf(_hq_time, _hq_steps[1] = 1) AS _hq_first'];
    entities = `_hq_entity_arrays AS (SELECT ${partition}, ${[...first, ...any.arrays].join(', ')} `
      + `FROM _hq_flagged GROUP BY ${partition}), `
      + `_hq_entities AS (SELECT ${[partition, ...cohort].join(', ')}, ${any.level} FROM _hq_entity_arrays)`;
  } else {
    const strict = strictLevelSql(steps, spec.windowMs);
    const first = spec.by === undefined ? [] : ['minIf(_hq_time, _hq_j = 1) AS _hq_first'];
    entities = `_hq_entities AS (SELECT ${partition}, ${[...first, strict.level].join(', ')} `
      + `FROM _hq_flagged ${strict.arrayJoin} GROUP BY ${partition})`;
  }

  const cohortColumn = spec.by === undefined
    ? []
    : [`formatDateTime(${dialect.truncateTime('_hq_first', spec.by)}, '%Y-%m-%d') AS _hq_cohort`];
  const reached = Array.from({ length: steps }, (_, index) => (
    `countIf(_hq_level >= ${index + 1}) AS _hq_r${index + 1}`
  ));
  const groupKeys = [...breakdown, ...(spec.by === undefined ? [] : ['_hq_cohort'])];
  // With no grouping key the aggregate returns one row even for no entities,
  // so an empty funnel still reports zero at every step.
  const groups = `_hq_groups AS (SELECT ${[...breakdown.map(alias => alias), ...cohortColumn, ...reached].join(', ')} `
    + `FROM _hq_entities${groupKeys.length ? ` WHERE _hq_level >= 1 GROUP BY ${groupKeys.join(', ')}` : ''})`;

  const orderBy = [
    ...(spec.by === undefined ? [] : ['_hq_cohort ASC']),
    ...(breakdown.length ? ['_hq_rank ASC'] : []),
  ];
  const body = rankedBreakdownSql({
    relation: '_hq_groups', breakdown, sizeColumn: '_hq_r1', limit: spec.breakdownLimit, orderBy,
  });
  const text = `WITH ${[...source.ctes, flagged, entities, groups].join(', ')} ${body}`;
  return { statement: { text, parameters: statement }, breakdown, readsFinal: readsFinal(source.joinCtx) };
}
