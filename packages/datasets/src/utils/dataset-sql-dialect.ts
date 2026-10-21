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
  const frozen = Object.isFrozen(rules) ? rules : receiverBoundSnapshot(rules);
  complete.add(frozen);
  return frozen;
}

/**
 * A frozen snapshot of a rule set that leaves the caller's object unfrozen.
 * Every member along the prototype chain is copied as an own property, with
 * methods bound to the original: a class-based rule set keeps its methods on
 * the prototype, and its `#private` fields exist only on the instance its
 * constructor ran on, so a copy must not become their receiver.
 */
function receiverBoundSnapshot<TRules extends object>(rules: TRules): Readonly<TRules> {
  const snapshot: object = Object.create(Object.getPrototypeOf(rules));
  const seen = new Set<PropertyKey>();
  for (let owner: object | null = rules; owner && owner !== Object.prototype; owner = Object.getPrototypeOf(owner)) {
    for (const key of Reflect.ownKeys(owner)) {
      if (key === 'constructor' || seen.has(key)) continue;
      seen.add(key);
      const value: unknown = Reflect.get(rules, key);
      // Define rather than assign: assignment cannot shadow a read-only
      // member inherited from a frozen prototype such as the ClickHouse rules.
      Object.defineProperty(snapshot, key, {
        value: typeof value === 'function' ? value.bind(rules) : value,
        enumerable: true,
      });
    }
  }
  return Object.freeze(snapshot) as Readonly<TRules>;
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
      quoteQualifiedName: (name: string) => name.split('.').map(part => dialect.quoteIdentifier(part)).join('.'),
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
