[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / datePart

# Function: datePart()

> **datePart**(`part`, `field`, `alias`?): [`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:90](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/utils/sql-expressions.ts#L90)

Extracts the specified part from a date/time value

## Parameters

### part

The part to extract (year, month, day, etc.)

`"year"` | `"quarter"` | `"month"` | `"week"` | `"day"` | `"hour"` | `"minute"` | `"second"`

### field

`string`

The field to extract from

### alias?

`string`

Optional alias for the result

## Returns

[`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

SQL expression or aliased expression
