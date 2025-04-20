[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / TableRecord

# Type Alias: TableRecord\<T\>

> **TableRecord**\<`T`\> = `{ [K in keyof T]: T[K] extends ColumnType ? InferColumnType<T[K]> : never }`

Defined in: [types/base.ts:31](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L31)

## Type Parameters

### T

`T`
