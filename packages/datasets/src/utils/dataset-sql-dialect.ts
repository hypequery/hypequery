import type { DatasetSqlDialect, DatasetSqlDialectRules } from '../dataset-sql-dialect.js';
import type { QueryBuilderFactoryInput } from '../query-builder-protocol.js';
import { clickhouseDatasetSqlDialect } from './clickhouse-dataset-sql-dialect.js';

const resolved = new WeakMap<DatasetSqlDialect, DatasetSqlDialectRules>();
const complete = new WeakSet<DatasetSqlDialect>();

/**
 * Register a complete engine rule set, so a factory can carry it as its
 * `datasetSqlDialect` and have it used as-is rather than completed with the
 * ClickHouse rules. Internal: for engine packages and tests.
 */
export function defineDatasetSqlDialectRules<TRules extends DatasetSqlDialectRules>(rules: TRules): Readonly<TRules> {
  const frozen = Object.isFrozen(rules) ? rules : Object.freeze({ ...rules });
  complete.add(frozen);
  return frozen;
}

/**
 * Complete a public dialect hook with the ClickHouse rules it does not
 * override. Memoized, so one hook always resolves to one rule set.
 */
export function completeDatasetSqlDialect(dialect: DatasetSqlDialect): DatasetSqlDialectRules {
  if (dialect === clickhouseDatasetSqlDialect) return clickhouseDatasetSqlDialect;
  if (complete.has(dialect)) return dialect as DatasetSqlDialectRules;
  let rules = resolved.get(dialect);
  if (!rules) {
    // Read the public members explicitly: a class-based hook keeps its methods
    // on the prototype, which spreading would silently drop.
    rules = Object.freeze({
      ...clickhouseDatasetSqlDialect,
      name: dialect.name,
      quoteIdentifier: (identifier: string) => dialect.quoteIdentifier(identifier),
    });
    resolved.set(dialect, rules);
  }
  return rules;
}

/** Resolve from the active factory, so a runtime builder override carries its dialect. */
export function resolveDatasetSqlDialect(factory: QueryBuilderFactoryInput): DatasetSqlDialectRules {
  return factory.datasetSqlDialect
    ? completeDatasetSqlDialect(factory.datasetSqlDialect)
    : clickhouseDatasetSqlDialect;
}
