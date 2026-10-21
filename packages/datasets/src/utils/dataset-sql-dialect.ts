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
 *
 * Own members are copied as they are, so a rule shared with another rule set
 * (spread from the ClickHouse rules, say) keeps its identity. Members a class
 * declares are read through the original instance, methods bound to it and
 * getters evaluated on it: its `#private` fields exist only on the object its
 * constructor ran on, so a copy must not become their receiver. Members
 * inherited from a plain object stay inherited.
 */
function receiverBoundSnapshot<TRules extends object>(rules: TRules): Readonly<TRules> {
  const snapshot: object = Object.create(Object.getPrototypeOf(rules), Object.getOwnPropertyDescriptors(rules));
  for (let owner = Object.getPrototypeOf(rules) as object | null; owner && isClassPrototype(owner); owner = Object.getPrototypeOf(owner)) {
    for (const key of Reflect.ownKeys(owner)) {
      if (key === 'constructor' || Object.hasOwn(snapshot, key)) continue;
      // Read through the original, so a getter sees its own private fields;
      // a method is bound to it for the same reason.
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

/** A prototype a class declaration created: its constructor points back at it. */
function isClassPrototype(owner: object): boolean {
  if (owner === Object.prototype || !Object.hasOwn(owner, 'constructor')) return false;
  const constructor: unknown = (owner as { constructor?: unknown }).constructor;
  return typeof constructor === 'function' && constructor.prototype === owner;
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
