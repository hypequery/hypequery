[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / AliasedExpression

# Interface: AliasedExpression

Defined in: [core/utils/sql-expressions.ts:12](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L12)

Represents an aliased SQL expression that can be used in select clauses

## Extends

- [`SqlExpression`](SqlExpression.md)

## Properties

### \_\_type

> **\_\_type**: `"aliased_expression"`

Defined in: [core/utils/sql-expressions.ts:13](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L13)

#### Overrides

[`SqlExpression`](SqlExpression.md).[`__type`](SqlExpression.md#__type)

***

### alias

> **alias**: `string`

Defined in: [core/utils/sql-expressions.ts:14](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L14)

## Methods

### toSql()

> **toSql**(): `string`

Defined in: [core/utils/sql-expressions.ts:6](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L6)

#### Returns

`string`

#### Inherited from

[`SqlExpression`](SqlExpression.md).[`toSql`](SqlExpression.md#tosql)
