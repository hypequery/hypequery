[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / rawAs

# Function: rawAs()

> **rawAs**(`sql`, `alias`): [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:35](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/utils/sql-expressions.ts#L35)

Creates an aliased SQL expression for use in SELECT clauses

## Parameters

### sql

`string`

The SQL expression string

### alias

`string`

The alias to use for the expression

## Returns

[`AliasedExpression`](../interfaces/AliasedExpression.md)

An AliasedExpression object
