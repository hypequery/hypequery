[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / rawAs

# Function: rawAs()

> **rawAs**(`sql`, `alias`): [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:35](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L35)

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
