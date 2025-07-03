[**hypequery ClickHouse API**](../README.md)

***

[hypequery ClickHouse API](../globals.md) / SqlExpression

# Interface: SqlExpression

Defined in: [core/utils/sql-expressions.ts:4](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/utils/sql-expressions.ts#L4)

Represents a raw SQL expression that can be used in queries

## Extended by

- [`AliasedExpression`](AliasedExpression.md)

## Properties

### \_\_type

> **\_\_type**: `string`

Defined in: [core/utils/sql-expressions.ts:5](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/utils/sql-expressions.ts#L5)

## Methods

### toSql()

> **toSql**(): `string`

Defined in: [core/utils/sql-expressions.ts:6](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/utils/sql-expressions.ts#L6)

#### Returns

`string`
