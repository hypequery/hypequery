export interface CanonicalValueLimits {
  readonly maxInputBytes: number;
  readonly maxCanonicalBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxCollectionItems: number;
  readonly maxStringBytes: number;
  readonly maxDecodedBytes: number;
}

export interface CanonicalValueOptions {
  /** Product policy may lower, but never raise, the version 1 limits. */
  readonly limits?: Partial<CanonicalValueLimits>;
  /** Containing ClickHouse type when validation depends on schema context. */
  readonly declaredClickHouseType?: string;
}

interface TagEnvelope<T> {
  readonly $hypequery: T;
}

interface VersionOneTag {
  readonly type: string;
  readonly version: 1;
}

export type IntegerTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'integer';
  readonly bits: 8 | 16 | 32 | 64 | 128 | 256;
  readonly signed: boolean;
  readonly value: string;
}>;

export type DecimalTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'decimal';
  readonly coefficient: string;
  readonly precision: number;
  readonly scale: number;
}>;

export type DateTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'date';
  readonly clickhouseType: 'Date' | 'Date32';
  readonly value: string;
}>;

export type DatetimeTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'datetime';
  readonly clickhouseType: 'DateTime' | 'DateTime64';
  readonly precision: number;
  readonly timezone: string;
  readonly value: string;
}>;

export type UuidTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'uuid';
  readonly value: string;
}>;

export type BytesTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'bytes';
  readonly encoding: 'base64url';
  readonly value: string;
}>;

export type EnumTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'enum';
  readonly bits: 8 | 16;
  readonly code: number;
  readonly label: string;
}>;

export type ArrayTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'array';
  readonly values: readonly CanonicalValue[];
}>;

export type TupleTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'tuple';
  readonly values: readonly CanonicalValue[];
}>;

export type MapTaggedValue = TagEnvelope<VersionOneTag & {
  readonly type: 'map';
  readonly entries: readonly (readonly [CanonicalValue, CanonicalValue])[];
}>;

export type TaggedValue =
  | IntegerTaggedValue
  | DecimalTaggedValue
  | DateTaggedValue
  | DatetimeTaggedValue
  | UuidTaggedValue
  | BytesTaggedValue
  | EnumTaggedValue
  | ArrayTaggedValue
  | TupleTaggedValue
  | MapTaggedValue;

/** Native numbers always carry floating-point semantics. Integers are tagged. */
export type CanonicalValue = null | boolean | string | number | TaggedValue;
