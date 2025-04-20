[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / toStartOfInterval

# Function: toStartOfInterval()

> **toStartOfInterval**(`field`, `interval`, `alias`?): [`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:77](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/utils/sql-expressions.ts#L77)

Truncates a date/time value to the start of the specified interval

## Parameters

### field

`string`

The field to truncate

### interval

`string`

The interval (e.g., '1 day', '15 minute')

### alias?

`string`

Optional alias for the result

## Returns

[`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

SQL expression or aliased expression
