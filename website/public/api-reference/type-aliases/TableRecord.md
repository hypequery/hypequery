[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / TableRecord

# Type Alias: TableRecord\<T\>

> **TableRecord**\<`T`\> = `{ [K in keyof T]: T[K] extends ColumnType ? InferColumnType<T[K]> : never }`

Defined in: [types/base.ts:31](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L31)

## Type Parameters

### T

`T`
