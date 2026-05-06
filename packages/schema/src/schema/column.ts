import type {
  ClickHouseColumnBuilderLike,
  ClickHouseColumnDefaultValue,
  ClickHouseDefaultInput,
  ClickHouseColumnDefinition,
  ClickHouseColumnType,
  ClickHouseNamedColumnType,
} from './types.js';
import { isSQLExpression } from '../utils/sql-tag.js';

type NamedTypeArgument = string | number;
type NestedColumnTypeInput = string | ClickHouseColumnBuilder | ClickHouseColumnType;

/**
 * Immutable builder for ClickHouse column definitions.
 *
 * Each modifier returns a new builder so reusable column fragments can be shared
 * safely without later calls mutating earlier definitions.
 */
export class ClickHouseColumnBuilder implements ClickHouseColumnBuilderLike {
  constructor(
    private readonly columnType: ClickHouseColumnType,
    private readonly defaultExpression?: ClickHouseColumnDefaultValue,
  ) {}

  /**
   * Adds a column default.
   *
   * Primitive values are rendered as SQL literals. Use the `sql` template tag for
   * database expressions such as `sql\`now()\``.
   */
  default(expression: ClickHouseDefaultInput): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(this.columnType, toDefaultValue(expression));
  }

  /**
   * Wraps this column type in `Nullable(...)`.
   */
  nullable(): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(
      { kind: 'nullable', inner: this.columnType },
      this.defaultExpression,
    );
  }

  /**
   * Wraps this column type in `LowCardinality(...)`.
   */
  lowCardinality(): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(
      { kind: 'low_cardinality', inner: this.columnType },
      this.defaultExpression,
    );
  }

  /**
   * Materializes the builder into a named column definition for a table AST.
   */
  build(name: string): ClickHouseColumnDefinition {
    return {
      name,
      type: this.columnType,
      ...(this.defaultExpression !== undefined ? { default: this.defaultExpression } : {}),
    };
  }

  /**
   * Returns the underlying type AST for nested type builders.
   */
  toColumnType(): ClickHouseColumnType {
    return this.columnType;
  }
}

/**
 * Factory helpers for common ClickHouse column types.
 *
 * Examples:
 * `column.String().default('pending')`, `column.Nullable('String')`,
 * `column.DateTime('UTC')`.
 */
export const column = {
  Int8: () => named('Int8'),
  Int16: () => named('Int16'),
  Int32: () => named('Int32'),
  Int64: () => named('Int64'),
  Int128: () => named('Int128'),
  Int256: () => named('Int256'),
  UInt8: () => named('UInt8'),
  UInt16: () => named('UInt16'),
  UInt32: () => named('UInt32'),
  UInt64: () => named('UInt64'),
  UInt128: () => named('UInt128'),
  UInt256: () => named('UInt256'),
  Float32: () => named('Float32'),
  Float64: () => named('Float64'),
  Decimal: (precision: number, scale: number) => named('Decimal', precision, scale),
  String: () => named('String'),
  FixedString: (length: number) => named('FixedString', length),
  Date: () => named('Date'),
  DateTime: (timezone?: string) => timezone ? named('DateTime', timezone) : named('DateTime'),
  DateTime64: (precision: number, timezone?: string) =>
    timezone ? named('DateTime64', precision, timezone) : named('DateTime64', precision),
  UUID: () => named('UUID'),
  JSON: () => named('JSON'),
  LowCardinality: (inner: NestedColumnTypeInput) =>
    new ClickHouseColumnBuilder({
      kind: 'low_cardinality',
      inner: normalizeNestedColumnType(inner),
    }),
  Nullable: (inner: NestedColumnTypeInput) =>
    new ClickHouseColumnBuilder({
      kind: 'nullable',
      inner: normalizeNestedColumnType(inner),
    }),
};

function named(name: string, ...argumentsList: NamedTypeArgument[]): ClickHouseColumnBuilder {
  const type: ClickHouseNamedColumnType = {
    kind: 'named',
    name,
    ...(argumentsList.length > 0 ? { arguments: argumentsList } : {}),
  };

  return new ClickHouseColumnBuilder(type);
}

function normalizeNestedColumnType(input: NestedColumnTypeInput): ClickHouseColumnType {
  if (typeof input === 'string') {
    return {
      kind: 'named',
      name: input,
    };
  }

  if (input instanceof ClickHouseColumnBuilder) {
    return input.toColumnType();
  }

  return input;
}

function toDefaultValue(input: ClickHouseDefaultInput): ClickHouseColumnDefaultValue {
  if (isSQLExpression(input)) {
    return {
      kind: 'sql',
      value: input,
    };
  }

  return {
    kind: 'literal',
    value: input,
  };
}
