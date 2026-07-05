import type {
  ClickHouseJsSafeInteger,
  ClickHouseJsUnsafeInteger,
  ClickHouseFloat,
  ClickHouseDecimal,
  ClickHouseDateTime,
  ClickHouseString,
  ClickHouseEnum,
  ClickHouseBoolean,
  ClickHouseType,
} from './clickhouse-types.js';
import type { ParseTopLevelArgs } from './type-helpers.js';
import type { ColumnType } from './schema.js';
import type { Simplify } from '../core/types/type-helpers.js';

type Add1<T extends number> = T extends 0 ? 1 : T extends 1 ? 2 : T extends 2 ? 3 : T extends 3 ? 4 : 5;

/**
 * Widened value type accepted when inserting into a column of ClickHouse type `T`.
 *
 * Mirrors the structure of `InferClickHouseType` (the read side) but accepts a
 * wider set of inputs where the JSONEachRow insert path tolerates them:
 * - Date/DateTime columns accept `string | Date | number`
 * - 64-bit and larger integers accept `string | number | bigint`
 * - Decimals accept `number | string`
 * - Enums accept the name or the numeric value
 *
 * `Date` and `bigint` values are normalized before reaching the ClickHouse client
 * (see `normalizeInsertRows`), since `JSON.stringify` throws on `bigint`.
 */
// The [ClickHouseType] extends [T] guard collapses non-concrete schemas
// (e.g. Record<string, ColumnType>) to `unknown` instead of distributing the
// full ClickHouse type union, which would blow past tsc's declaration
// serialization limit for callers that don't pass a schema generic.
export type InsertValue<T extends string, Depth extends number = 0> =
  [ClickHouseType] extends [T] ? unknown : InsertValueOf<T, Depth>;

type InsertValueOf<T extends string, Depth extends number> =
  Depth extends 5
  ? unknown
  : T extends ClickHouseJsSafeInteger ? number
  : T extends ClickHouseJsUnsafeInteger ? string | number | bigint
  : T extends ClickHouseFloat ? number
  : T extends ClickHouseDecimal ? number | string
  : T extends ClickHouseDateTime ? string | Date | number
  : T extends ClickHouseString ? string
  : T extends ClickHouseEnum ? string | number
  : T extends ClickHouseBoolean ? boolean
  : T extends `Array(${infer U})`
  ? U extends ClickHouseType
  ? Array<InsertValue<U, Add1<Depth>>>
  : unknown[]
  : T extends `Tuple(${infer U})`
  ? ParseTopLevelArgs<U> extends infer Parts extends string[]
    ? { [K in keyof Parts]: InsertValue<Parts[K] & ClickHouseType, Add1<Depth>> }
    : unknown[]
  : T extends `Nullable(${infer U})`
  ? U extends ClickHouseType
  ? InsertValue<U, Add1<Depth>> | null
  : unknown | null
  : T extends `LowCardinality(${infer U})`
  ? U extends `Nullable(${infer V})`
    ? V extends ClickHouseString | ClickHouseEnum
      ? InsertValue<V, Add1<Depth>> | null
      : unknown | null
    : U extends ClickHouseString | ClickHouseEnum
      ? InsertValue<U, Add1<Depth>>
      : unknown
  : T extends `Map(${string}, ${infer V})`
  ? V extends ClickHouseType
  ? Record<string, InsertValue<V, Add1<Depth>>>
  : Record<string, unknown>
  : unknown;

type IsNullableColumn<T extends string> =
  T extends `Nullable(${string})` ? true
  : T extends `LowCardinality(Nullable(${string}))` ? true
  : false;

/**
 * Row shape required when inserting into a chosen subset of a table's columns.
 * `Nullable(...)` columns are optional; every other selected column is required.
 */
export type InsertRowForColumns<
  Columns extends Record<string, ColumnType>,
  Keys extends keyof Columns
> = Simplify<
  { [K in Keys as IsNullableColumn<Columns[K] & string> extends true ? never : K]: InsertValue<Columns[K] & string> } &
  { [K in Keys as IsNullableColumn<Columns[K] & string> extends true ? K : never]?: InsertValue<Columns[K] & string> | null }
>;

/**
 * The full-width row shape required by `InsertBuilder.values()` for a table.
 * `Nullable(...)` columns are optional; every other column is required.
 */
export type InsertRow<Columns extends Record<string, ColumnType>> =
  InsertRowForColumns<Columns, keyof Columns>;
