import type { AnyDatasetInstance } from '../types.js';
import type { DatasetQueryExecutionOptions } from '../dataset-query.js';
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import { assertRawSqlForDialect } from './raw-sql-dialect-check.js';
import { StatementParameters } from './statement-parameters.js';
import { buildEventSourceSql } from './event-source-sql.js';
import { eventConditionFlagSql } from './event-condition-sql.js';
import { rankedBreakdownSql } from './event-breakdown-sql.js';
import { resolveTimeAxisRange } from './time-axis-bounds.js';
import { queryTimezoneName } from './query-timezone.js';
import type { RetentionSpec } from './event-operation-spec.js';
import type { PlannedEventStatement } from './funnel-sql.js';

/**
 * Plan retention (RFC 0027) as one statement: scan → per entity, the bucket
 * of its first start event and the set of buckets it returned in → per
 * cohort, its size and how many returned in each of the next N buckets →
 * ranked breakdown groups.
 *
 * Each cohort also reports how many of its periods end by the range end;
 * later ones are not fully observed and get no row.
 */
export function buildRetentionSql(
  ds: AnyDatasetInstance,
  spec: RetentionSpec,
  options: DatasetQueryExecutionOptions,
  readsFinal: (joinCtx: ReturnType<typeof buildEventSourceSql>['joinCtx']) => boolean,
): PlannedEventStatement {
  const dialect = resolveDatasetSqlDialect(options.builderFactory);
  if (dialect.name !== 'clickhouse') {
    throw new Error(`Retention needs ClickHouse; the "${dialect.name}" datasets dialect has no equivalent yet.`);
  }
  assertRawSqlForDialect(ds, dialect);
  const range = resolveTimeAxisRange(ds, [...spec.filters]);
  if (!range) throw new Error('Retention requires exactly one bounded time range.');
  const statement = new StatementParameters(dialect);
  const conditionFields = [...new Set([...spec.start, ...spec.return].map(condition => condition.field))];
  const source = buildEventSourceSql(ds, {
    entity: spec.entity,
    breakdown: spec.breakdown,
    conditionFields,
    filters: spec.filters,
    ...(spec.timezone === undefined ? {} : { timezone: spec.timezone }),
  }, options, statement);
  const breakdown = source.breakdown;
  const partition = ['_hq_entity', ...breakdown].join(', ');
  const start = eventConditionFlagSql(spec.start, source.conditionColumn, statement);
  const returning = eventConditionFlagSql(spec.return, source.conditionColumn, statement);
  const bucket = dialect.truncateTime('_hq_time', spec.grain);
  const flagged = `_hq_flagged AS (SELECT _hq_time, ${partition}, ${start} AS _hq_start, ${returning} AS _hq_return `
    + 'FROM _hq_events WHERE _hq_start = 1 OR _hq_return = 1)';
  const entities = `_hq_entities AS (SELECT ${partition}, minIf(${bucket}, _hq_start = 1) AS _hq_cohort_start, `
    + `groupUniqArrayIf(${bucket}, _hq_return = 1) AS _hq_returns FROM _hq_flagged `
    + `GROUP BY ${partition} HAVING countIf(_hq_start = 1) > 0)`;

  const period = (index: string) => dialect.addTime('_hq_cohort_start', index, spec.grain);
  const zone = queryTimezoneName(spec.timezone);
  const upper = dialect.parseTimestamp(statement.bind(range.end.text, 'string'), dialect.stringLiteral(zone));
  const periods = `range(1, ${spec.periods + 1})`;
  const groupKeys = [...breakdown, '_hq_cohort_start'].join(', ');
  const groups = `_hq_groups AS (SELECT ${[
    ...breakdown,
    `formatDateTime(_hq_cohort_start, '%Y-%m-%d') AS _hq_cohort`,
    'count() AS _hq_size',
    `sumForEach(arrayMap(_hq_p -> toUInt64(has(_hq_returns, ${period('_hq_p')})), ${periods})) AS _hq_retained`,
    // A period is reported only when its whole bucket ends by the range end:
    // a partly covered one would understate retention. A bucket boundary is
    // local midnight in the query zone, whatever the bucket's type.
    `arrayCount(_hq_p -> ${dialect.toQueryTimezone(period('_hq_p + 1'), zone)} <= ${upper}, ${periods}) AS _hq_observable`,
  ].join(', ')} FROM _hq_entities GROUP BY ${groupKeys})`;

  const body = rankedBreakdownSql({
    relation: '_hq_groups', breakdown, sizeColumn: '_hq_size', limit: spec.breakdownLimit,
    orderBy: [...(breakdown.length ? ['_hq_rank ASC'] : []), '_hq_cohort ASC'],
  });
  const text = `WITH ${[...source.ctes, flagged, entities, groups].join(', ')} ${body}`;
  return { statement: { text, parameters: statement }, breakdown, readsFinal: readsFinal(source.joinCtx) };
}
