import type { QueryBuilderFactoryInput, QueryBuilderLike } from '../query-builder-protocol.js';
import { toQueryBuilderFactory } from '../query-builder-protocol.js';
import type { AggregationType, AnyDatasetInstance } from '../types.js';
import { resolveDatasetSqlDialect } from './dataset-sql-dialect.js';
import { rawSqlErrorMessage } from './raw-sql-dialect-check.js';

/** The optional builder method each aggregation needs; core aggregations need none. */
const AGGREGATION_METHODS: Partial<Record<AggregationType, keyof QueryBuilderLike>> = {
  argMax: 'argMax',
  argMin: 'argMin',
  percentile: 'quantile',
  stddev: 'stddev',
  variance: 'variance',
  approxCountDistinct: 'approxCountDistinct',
  merge: 'mergeState',
};

/**
 * Everything about *ds* the engine behind *queryBuilder* cannot run, found
 * without a query: raw `sql` that is not one expression under the engine's
 * lexer, `final: true` without a row-version modifier, aggregations and
 * relationships the builder does not implement. Empty when it can run them all.
 */
export function datasetQueryBuilderErrors(ds: AnyDatasetInstance, queryBuilder: QueryBuilderFactoryInput): string[] {
  const factory = toQueryBuilderFactory(queryBuilder);
  const dialect = resolveDatasetSqlDialect(factory);
  const builder = probeBuilder(factory, ds.source);
  const engine = `the ${dialect.name} query builder`;
  const errors: string[] = [];

  const rawSql: ['dimension' | 'measure', string, string | undefined][] = [
    ...Object.entries(ds.dimensions).map(([name, definition]) => ['dimension', name, definition.sql] as ['dimension', string, string | undefined]),
    ...Object.entries(ds.measures).map(([name, definition]) =>
      ['measure', name, 'sql' in definition ? definition.sql as string | undefined : undefined] as ['measure', string, string | undefined]),
  ];
  for (const [kind, name, sql] of rawSql) {
    const error = sql === undefined ? undefined : dialect.rawSqlExpressionError(sql);
    if (error) errors.push(rawSqlErrorMessage(kind, name, error));
  }

  // Builder capabilities are checked only when a builder can be probed;
  // a test double or lazily bound factory may not produce one up front.
  if (builder && ds.final && typeof builder.final !== 'function') {
    errors.push(`final: true needs a row-version modifier (ClickHouse FINAL), which ${engine} does not have.`);
  }

  for (const [name, definition] of Object.entries(ds.measures)) {
    const aggregation = 'aggregation' in definition ? definition.aggregation as AggregationType : undefined;
    const method = aggregation ? AGGREGATION_METHODS[aggregation] : undefined;
    if (builder && method && typeof builder[method] !== 'function') {
      errors.push(`measure "${name}" uses ${aggregation}, which ${engine} does not support.`);
    }
  }

  for (const [name, relationship] of Object.entries(ds.relationships ?? {})) {
    if (builder && typeof builder.leftAnyJoin !== 'function') {
      errors.push(`relationship "${name}" needs a single-match join (leftAnyJoin), which this query builder does not implement.`);
      continue;
    }
    const target = relationship.target() as Partial<AnyDatasetInstance>;
    if (target.final && !dialect.finalTable) {
      errors.push(`relationship "${name}" joins final dataset "${target.name}", which ${engine} cannot read with FINAL.`);
    }
  }

  return errors.map(error => `Dataset "${ds.name}": ${error}`);
}

/** A builder over *source*, or undefined when the factory cannot produce one without a query. */
function probeBuilder(factory: ReturnType<typeof toQueryBuilderFactory>, source: string): Partial<QueryBuilderLike> | undefined {
  try {
    const builder: unknown = typeof factory.table === 'function' ? factory.table(source) : undefined;
    return builder !== null && typeof builder === 'object' ? builder as Partial<QueryBuilderLike> : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuse, up front, datasets the engine behind *queryBuilder* cannot run, so
 * a mismatch fails when an API or client is set up rather than on the first
 * query that reaches it.
 */
export function assertDatasetsSupported(
  datasets: Iterable<AnyDatasetInstance> | Record<string, AnyDatasetInstance>,
  queryBuilder: QueryBuilderFactoryInput,
): void {
  const list = Symbol.iterator in Object(datasets)
    ? [...datasets as Iterable<AnyDatasetInstance>]
    : Object.values(datasets as Record<string, AnyDatasetInstance>);
  const errors = list.flatMap(ds => datasetQueryBuilderErrors(ds, queryBuilder));
  if (errors.length) {
    throw new Error(`These datasets cannot run on this query builder:\n- ${errors.join('\n- ')}`);
  }
}
