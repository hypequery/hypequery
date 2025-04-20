[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / TableRecord

# Type Alias: TableRecord\<T\>

> **TableRecord**\<`T`\> = `{ [K in keyof T]: T[K] extends ColumnType ? InferColumnType<T[K]> : never }`

Defined in: [types/base.ts:31](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/types/base.ts#L31)

## Type Parameters

### T

`T`
