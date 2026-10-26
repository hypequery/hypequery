import type { AggregationType, DimensionType, MeasureDefinition, TimeGrain } from './types.js';
import type { SemanticBinaryOperator, SemanticFunctionName } from './semantic-plan.js';

/**
 * SQL rendering owned by the semantic datasets layer, separate from a query
 * builder's compiler dialect. Extend this contract as emission sites migrate.
 * Only the ClickHouse implementation is supported today.
 */
export interface DatasetSqlDialect {
  readonly name: string;
  /** Quote one output identifier; dots in a qualified semantic alias are literal. */
  quoteIdentifier(identifier: string): string;
}

/** A formula binary operator, matching `SemanticExpression` `binary` nodes. */
export type DatasetSqlBinaryOperator = SemanticBinaryOperator;

/** The logical type of a bound value, when the planner knows it. */
export type DatasetSqlParameterType = DimensionType | { readonly array: DimensionType };

/** A value bound into a statement, with its logical type when known. */
export interface DatasetSqlBoundParameter {
  readonly value: unknown;
  readonly type?: DatasetSqlParameterType;
}

/** Why a raw `sql` expression is not one safe expression under a dialect's lexical rules. */
export type DatasetRawSqlExpressionError = 'unterminated-literal' | 'statement-break';

/** A wall-clock component read from a zoned timestamp. */
export type DatasetSqlClockPart = 'Hour' | 'Minute' | 'Second';

/**
 * Every engine-specific spelling the datasets planner emits outside the query
 * builder. Arguments are already-rendered SQL expressions; implementations
 * only spell them, so planning decisions stay shared across engines.
 *
 * Internal: engines implement the full rule set. The public
 * `DatasetSqlDialect` hook may override a subset, which
 * `resolveDatasetSqlDialect` merges onto the ClickHouse rules.
 */
export interface DatasetSqlDialectRules extends DatasetSqlDialect {
  // Parameters
  /** Spell the placeholder for the value at `index` in the rendered parameter array. */
  placeholder(index: number, parameter: DatasetSqlBoundParameter): string;
  /** A repeated value re-uses its placeholder (`$k`) rather than binding again. */
  readonly reusesPlaceholders: boolean;
  /** A builder's own positional `?` statement can be embedded verbatim. */
  readonly embedsPositionalPieces: boolean;

  // Ordering and pagination of planner-assembled statements
  /**
   * One ORDER BY term. Engines whose NULL placement differs from ClickHouse
   * (NULLs last in both directions) add explicit `NULLS` clauses here so
   * results order identically. No direction keeps the engine default (ASC).
   */
  orderTerm(expression: string, direction?: 'ASC' | 'DESC'): string;
  /**
   * The trailing pagination clause, including its leading space, or ''.
   * Engines that reject OFFSET without LIMIT supply a LIMIT here.
   */
  paginate(limit: number | undefined, offset: number | undefined): string;

  // Identifiers and raw SQL
  /** Quote a dotted physical source path (`analytics.orders`). */
  quoteQualifiedName(name: string): string;
  /**
   * A quoted table read with row-version resolution (ClickHouse `FINAL`), used
   * for joined targets declared `final: true`. Omit it on engines without such
   * a modifier; those datasets are then refused instead of read unresolved.
   */
  finalTable?(quotedSource: string): string;
  /**
   * Check that author-written raw `sql` is one expression under this engine's
   * lexical rules: no terminator or comment hidden outside a literal. Engines
   * differ (backslash escapes, `#` comments, triple-quoted strings), so an
   * engine that cannot check its own raw SQL must reject it here rather than
   * inherit another engine's rules.
   */
  rawSqlExpressionError(sql: string): DatasetRawSqlExpressionError | undefined;

  // Literals
  stringLiteral(value: string): string;
  /** A literal compared against a column inside a measure filter. */
  measureFilterLiteral(value: unknown): string;

  // Time
  /** Truncate a timestamp to the start of its grain bucket. */
  truncateTime(time: string, grain: TimeGrain): string;
  /** Truncate like `truncateTime`, returning a timestamp in the zone `timezone` evaluates to. */
  truncateTimeInZone(time: string, grain: TimeGrain, timezone: string): string;
  /** Move a timestamp forward by `amount` grains; `amount` may be an expression. */
  addTime(time: string, amount: string | number, grain: TimeGrain): string;
  /** Move a timestamp back by a literal number of grains. */
  subtractTime(time: string, amount: number, grain: TimeGrain): string;
  /** Whole grain boundaries crossed from `start` to `end`. */
  timeDiff(grain: TimeGrain, start: string, end: string): string;
  /** Convert a source time to the query timezone, a validated canonical IANA name. */
  toQueryTimezone(time: string, timezone: string): string;
  /** Parse a timestamp from a string expression, such as a bound placeholder, in the zone `timezone` evaluates to. */
  parseTimestamp(value: string, timezone: string): string;
  /** The timezone a zoned timestamp expression carries. */
  timezoneOf(time: string): string;
  /** One wall-clock component of a zoned timestamp. */
  clockPart(part: DatasetSqlClockPart, time: string): string;
  /** True when a value's physical type is a date without a time of day. */
  isDateOnlyType(value: string): string;

  // Control flow and guards
  /** Fail the statement with `message` when `condition` holds; evaluates to 0 otherwise. */
  guard(condition: string, message: string): string;
  ifElse(condition: string, then: string, otherwise: string): string;
  greatest(...values: string[]): string;
  least(...values: string[]): string;
  /** NULL-safe equality. */
  isNotDistinctFrom(left: string, right: string): string;
  isNotNull(value: string): string;
  /** Narrow a value the planner has already proven non-NULL. */
  assumeNotNull(value: string): string;
  /** Widen a value to a nullable type, so unmatched joins yield NULL. */
  toNullable(value: string): string;
  /** Count rows matching `condition`. */
  countIf(condition: string): string;
  /** Expand each row into `count` rows carrying the indices 0..count-1. */
  seriesIndex(count: string): string;
  /** True when `predicate`, which reads `index`, holds for some index in 0..count-1. */
  anyIndex(index: string, count: string, predicate: string): string;

  // Row packing
  /** Pack expressions into one positional value, isolating their names. */
  packRow(values: readonly string[]): string;
  /** Read the 1-based `position` from a packed row. */
  rowElement(row: string, position: number): string;
  /** Every column of `relation` except `columns`. */
  selectAllExcept(relation: string, columns: readonly string[]): string;
  /** Join keyword matching each left row to the nearest preceding right row. */
  readonly asofLeftJoin: string;

  // Aggregates
  /** Wrap a filtered measure's input so non-matching rows contribute `fallback`. */
  filteredAggregateInput(condition: string, value: string, fallback: '0' | 'NULL'): string;
  /** A time-measure aggregate: NULL over an empty population unless it counts. */
  windowAggregate(definition: MeasureDefinition, value: string, arg: string): string;
  /** Re-aggregate partial results; NULL over an empty population. */
  reaggregate(aggregation: AggregationType, value: string): string;

  // Formulas
  formulaLiteral(value: string | number | boolean | null): string;
  formulaBinary(operator: DatasetSqlBinaryOperator, left: string, right: string): string;
  formulaFunction(name: SemanticFunctionName, args: readonly string[]): string;
}
