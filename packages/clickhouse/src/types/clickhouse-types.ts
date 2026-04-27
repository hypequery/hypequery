import type { ParseTopLevelArgs } from './type-helpers.js';

export type ClickHouseInteger =
  | 'Int8' | 'Int16' | 'Int32' | 'Int64' | 'Int128' | 'Int256'
  | 'UInt8' | 'UInt16' | 'UInt32' | 'UInt64' | 'UInt128' | 'UInt256';

export type ClickHouseJsSafeInteger =
  | 'Int8' | 'Int16' | 'Int32'
  | 'UInt8' | 'UInt16' | 'UInt32';

export type ClickHouseJsUnsafeInteger =
  Exclude<ClickHouseInteger, ClickHouseJsSafeInteger>;

export type ClickHouseFloat = 'Float32' | 'Float64';

export type ClickHouseDecimal =
  | 'Decimal32' | 'Decimal64' | 'Decimal128' | 'Decimal256'
  | `Decimal(${number}, ${number})`;

export type ClickHouseDateTime =
  | 'Date' | 'Date32'
  | 'DateTime'
  | `DateTime('${string}')`
  | `DateTime64(${number})`
  | `DateTime64(${number}, '${string}')`;

export type ClickHouseString =
  | 'String'
  | `FixedString(${number})`
  | 'UUID';

export type ClickHouseBoolean = 'Bool' | 'Boolean';

export type ClickHouseEnum =
  | `Enum8(${string})`
  | `Enum16(${string})`;

export type ClickHouseBaseType =
  | ClickHouseInteger
  | ClickHouseFloat
  | ClickHouseDecimal
  | ClickHouseDateTime
  | ClickHouseString
  | ClickHouseBoolean
  | ClickHouseEnum;

export type ClickHouseType =
  | ClickHouseBaseType
  | `Array(${ClickHouseBaseType})`
  | `Array(Nullable(${ClickHouseBaseType}))`
  | `Array(LowCardinality(String))`
  | `Array(LowCardinality(${ClickHouseEnum}))`
  | `Array(Tuple(${string}))`
  | `Nullable(${ClickHouseBaseType})`
  | `Nullable(Array(${ClickHouseBaseType}))`
  | `Nullable(Array(Tuple(${string})))`
  | `Nullable(Tuple(${string}))`
  | `LowCardinality(${ClickHouseString})`
  | `LowCardinality(${ClickHouseEnum})`
  | `LowCardinality(Nullable(${ClickHouseString}))`
  | `LowCardinality(Nullable(${ClickHouseEnum}))`
  | `Map(String, ${ClickHouseBaseType})`
  | `Map(String, Array(${ClickHouseBaseType}))`
  | `Map(String, Nullable(${ClickHouseBaseType}))`
  | `Map(String, Tuple(${string}))`
  | `Map(String, Array(Tuple(${string})))`
  | `Map(LowCardinality(String), ${ClickHouseBaseType})`
  | `Map(LowCardinality(String), Array(${ClickHouseBaseType}))`
  | `Map(LowCardinality(String), Nullable(${ClickHouseBaseType}))`
  | `Map(LowCardinality(String), Tuple(${string}))`
  | `Map(LowCardinality(String), Array(Tuple(${string})))`
  | `Map(${ClickHouseInteger}, ${ClickHouseBaseType})`
  | `Map(${ClickHouseInteger}, Array(${ClickHouseBaseType}))`
  | `Map(${ClickHouseInteger}, Nullable(${ClickHouseBaseType}))`
  | `Map(${ClickHouseInteger}, Tuple(${string}))`
  | `Map(${ClickHouseInteger}, Array(Tuple(${string})))`
  | `Array(Map(String, ${ClickHouseBaseType}))`
  | `Array(Map(String, Tuple(${string})))`
  | `Array(Map(LowCardinality(String), ${ClickHouseBaseType}))`
  | `Array(Map(LowCardinality(String), Tuple(${string})))`
  | `Array(Map(${ClickHouseInteger}, ${ClickHouseBaseType}))`
  | `Array(Map(${ClickHouseInteger}, Tuple(${string})))`
  | `Nullable(Map(String, ${ClickHouseBaseType}))`
  | `Nullable(Map(String, Tuple(${string})))`
  | `Nullable(Map(LowCardinality(String), ${ClickHouseBaseType}))`
  | `Nullable(Map(LowCardinality(String), Tuple(${string})))`
  | `Tuple(${string})`;

// Cap recursive expansion for nested ClickHouse wrappers to keep type instantiation bounded.
export type InferClickHouseType<T extends string, Depth extends number = 0> =
  Depth extends 5
  ? unknown
  : T extends ClickHouseJsSafeInteger ? number
  : T extends ClickHouseJsUnsafeInteger ? string
  : T extends ClickHouseFloat ? number
  : T extends ClickHouseDecimal ? number
  : T extends ClickHouseDateTime ? string
  : T extends ClickHouseString ? string
  : T extends ClickHouseEnum ? string
  : T extends ClickHouseBoolean ? boolean
  : T extends `Array(${infer U})`
  ? U extends ClickHouseType
  ? Array<InferClickHouseType<U, Add1<Depth>>>
  : unknown[]
  : T extends `Tuple(${infer U})`
  ? ParseTopLevelArgs<U> extends infer Parts extends string[]
    ? { [K in keyof Parts]: InferClickHouseType<Parts[K] & ClickHouseType, Add1<Depth>> }
    : unknown[]
  : T extends `Nullable(${infer U})`
  ? U extends ClickHouseType
  ? InferClickHouseType<U, Add1<Depth>> | null
  : unknown | null
  : T extends `LowCardinality(${infer U})`
  ? U extends `Nullable(${infer V})`
    ? V extends ClickHouseString | ClickHouseEnum
      ? InferClickHouseType<V, Add1<Depth>> | null
      : unknown | null
    : U extends ClickHouseString | ClickHouseEnum
      ? InferClickHouseType<U, Add1<Depth>>
      : unknown
  : T extends `Map(${string}, ${infer V})`
  ? V extends ClickHouseType
  ? Record<string, InferClickHouseType<V, Add1<Depth>>>
  : Record<string, unknown>
  : unknown;

type Add1<T extends number> = T extends 0 ? 1 : T extends 1 ? 2 : T extends 2 ? 3 : T extends 3 ? 4 : 5;

// Schema type for defining table structures
export type ClickHouseSchema = Record<string, ClickHouseType>;

// Utility to infer TypeScript types from a ClickHouse schema
export type InferSchemaType<T extends ClickHouseSchema> = {
  [K in keyof T]: InferClickHouseType<T[K]>;
};
