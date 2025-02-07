// Basic numeric types
export type ClickHouseInteger =
  | 'Int8' | 'Int16' | 'Int32' | 'Int64' | 'Int128' | 'Int256'
  | 'UInt8' | 'UInt16' | 'UInt32' | 'UInt64' | 'UInt128' | 'UInt256';

export type ClickHouseFloat = 'Float32' | 'Float64';

export type ClickHouseDecimal =
  | 'Decimal32' | 'Decimal64' | 'Decimal128' | 'Decimal256'
  | `Decimal(${number}, ${number})`; // For precision and scale

// Date and time types
export type ClickHouseDateTime =
  | 'Date' | 'Date32'
  | 'DateTime'
  | `DateTime64(${number})` // For subsecond precision
  | `DateTime64(${number}, '${string}')`; // With timezone

// String types
export type ClickHouseString =
  | 'String'
  | `FixedString(${number})`
  | 'UUID';

// Complex types
export type ClickHouseArray = `Array(${ClickHouseBaseType})`;
export type ClickHouseNullable = `Nullable(${ClickHouseBaseType})`;
export type ClickHouseLowCardinality = `LowCardinality(${ClickHouseString})`;
export type ClickHouseMap = `Map(${ClickHouseBaseType}, ${ClickHouseBaseType})`;

// Base type combining all possible types
export type ClickHouseBaseType =
  | ClickHouseInteger
  | ClickHouseFloat
  | ClickHouseDecimal
  | ClickHouseDateTime
  | ClickHouseString;

// Combined type for all possible ClickHouse types
export type ClickHouseType =
  | ClickHouseBaseType
  | ClickHouseArray
  | ClickHouseNullable
  | ClickHouseLowCardinality
  | ClickHouseMap;

// Type inference helper
export type InferClickHouseType<T extends ClickHouseType> =
  T extends ClickHouseInteger ? number :
  T extends ClickHouseFloat ? number :
  T extends ClickHouseDecimal ? number :
  T extends ClickHouseDateTime ? Date :
  T extends ClickHouseString ? string :
  T extends `Array(${infer U extends ClickHouseBaseType})` ? Array<InferClickHouseType<U>> :
  T extends `Nullable(${infer U extends ClickHouseBaseType})` ? InferClickHouseType<U> | null :
  T extends `LowCardinality(${infer U extends ClickHouseString})` ? InferClickHouseType<U> :
  T extends `Map(${infer K extends ClickHouseBaseType}, ${infer V extends ClickHouseBaseType})` ?
  Map<InferClickHouseType<K>, InferClickHouseType<V>> :
  never;