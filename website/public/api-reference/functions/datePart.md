[**hypequery ClickHouse API**](../README.md)

***

[hypequery ClickHouse API](../globals.md) / datePart

# Function: datePart()

> **datePart**(`part`, `field`, `alias`?): [`SqlExpression`](../interfaces/SqlExpression.md) \| [`AliasedExpression`](../interfaces/AliasedExpression.md)

Defined in: [core/utils/sql-expressions.ts:90](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/utils/sql-expressions.ts#L90)

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
