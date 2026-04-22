import type {
  ClickHouseColumnBuilderLike,
  ClickHouseColumnDefinition,
  ClickHouseColumnType,
  ClickHouseNamedColumnType,
  ClickHouseSqlExpression,
} from './types.js';

type NamedTypeArgument = string | number;
type NestedColumnTypeInput = string | ClickHouseColumnBuilder | ClickHouseColumnType;

export class ClickHouseColumnBuilder implements ClickHouseColumnBuilderLike {
  constructor(
    private readonly columnType: ClickHouseColumnType,
    private readonly defaultExpression?: ClickHouseSqlExpression,
  ) {}

  default(expression: ClickHouseSqlExpression): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(this.columnType, expression);
  }

  nullable(): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(
      { kind: 'nullable', inner: this.columnType },
      this.defaultExpression,
    );
  }

  lowCardinality(): ClickHouseColumnBuilder {
    return new ClickHouseColumnBuilder(
      { kind: 'low_cardinality', inner: this.columnType },
      this.defaultExpression,
    );
  }

  build(name: string): ClickHouseColumnDefinition {
    return {
      name,
      type: this.columnType,
      ...(this.defaultExpression !== undefined ? { default: this.defaultExpression } : {}),
    };
  }

  toColumnType(): ClickHouseColumnType {
    return this.columnType;
  }
}

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
