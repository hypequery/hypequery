[**hypequery ClickHouse API**](../README.md)

***

[hypequery ClickHouse API](../globals.md) / formatDateTime

# Function: formatDateTime()

> **formatDateTime**(`field`, `format`, `alias`?): [`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:64](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/utils/sql-expressions.ts#L64)

Formats a DateTime value using the specified format

## Parameters

### field

`string`

The field or expression to format

### format

`string`

The date format string

### alias?

`string`

Optional alias for the result

## Returns

[`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

SQL expression or aliased expression
