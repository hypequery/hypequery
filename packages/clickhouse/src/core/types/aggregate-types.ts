import type { ClickHouseDateTime, ClickHouseDecimal, ClickHouseFloat } from '../../types/clickhouse-types.js';
import type { ColumnType } from '../../types/schema.js';
import type { AnyBuilderState, ResolveTableSchema } from './builder-state.js';
import type { ColumnSelectionValue } from './select-types.js';

/**
 * The ClickHouse type string behind a column reference, or `unknown` when the
 * builder only knows its TypeScript type (CTE columns, computed outputs).
 */
export type ColumnClickHouseType<State extends AnyBuilderState, Column> =
  Column extends `${infer Table}.${infer Name}`
    ? [ResolveTableSchema<State, Table>] extends [never]
      ? unknown
      : Name extends keyof ResolveTableSchema<State, Table>
        ? ResolveTableSchema<State, Table>[Name]
        : unknown
    : Column extends keyof State['base']
      ? State['base'][Column]
      : unknown;

/**
 * What `sum()` returns, as checked on ClickHouse 26.6: integers widen to
 * `Int64`/`UInt64` (or stay 128/256-bit), which the adapter quotes, so they
 * arrive as strings; `Float*` sums are `Float64` and `Decimal` sums are
 * `Decimal(38, S)`, both JSON numbers; a `Nullable` column sums to `NULL` when
 * every value is `NULL`.
 */
export type SumResult<T> =
  T extends `Nullable(${infer Inner})` ? SumResult<Inner> | null
  : T extends `LowCardinality(${infer Inner})` ? SumResult<Inner>
  : T extends `SimpleAggregateFunction(${string}, ${infer Inner})` ? SumResult<Inner>
  : T extends ClickHouseFloat | ClickHouseDecimal ? number
  : string;

/**
 * `sum()` over a column the builder knows only by its TypeScript type (a
 * subquery or CTE column). A `number` may come from an integer column, whose
 * sum is a quoted Int64, or a Float/Decimal one, whose sum is a number.
 */
export type SumOfValueResult<Value> =
  [Value] extends [number] ? number | string
  : [Value] extends [number | null] ? number | string | null
  : string;

/** `sum()` result for a column reference, by ClickHouse type when known. */
export type SumColumnResult<State extends AnyBuilderState, Column> =
  ColumnClickHouseType<State, Column> extends ColumnType
    ? SumResult<ColumnClickHouseType<State, Column>>
    : SumOfValueResult<ColumnSelectionValue<State, Column>>;

/**
 * `avg()` is `Float64` for every numeric input, so a JSON number. It is `null`
 * for a `Nullable` column whose values are all `NULL`, and for an ungrouped
 * query over zero rows, where ClickHouse returns NaN and writes it as `null`.
 */
export type AvgResult = number | null;

/** `min`, `max`, `argMin` and `argMax` return a value of the column's own type. */
export type ColumnValueResult<State extends AnyBuilderState, Column> =
  ColumnSelectionValue<State, Column>;

/**
 * `quantile()` returns the column's type for dates and times (a string) and a
 * number for numeric columns (`Float64`, or `Decimal` for a `Decimal` column).
 * It is `null` over zero rows.
 */
export type QuantileResult<T> =
  T extends `Nullable(${infer Inner})` ? QuantileResult<Inner>
  : T extends `LowCardinality(${infer Inner})` ? QuantileResult<Inner>
  : T extends `SimpleAggregateFunction(${string}, ${infer Inner})` ? QuantileResult<Inner>
  : T extends ClickHouseDateTime ? string | null
  : number | null;

/** `stddevSamp()` and `varSamp()` are `Float64`, and `null` for fewer than two rows. */
export type SampleStatisticResult = number | null;

/** `count`, `countDistinct` and `uniq` return `UInt64`, which the adapter quotes. */
export type CountResult = string;
