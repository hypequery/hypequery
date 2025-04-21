[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / PaginationOptions

# Interface: PaginationOptions\<T\>

Defined in: [types/base.ts:73](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L73)

## Type Parameters

### T

`T`

## Properties

### after?

> `optional` **after**: `string`

Defined in: [types/base.ts:75](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L75)

***

### before?

> `optional` **before**: `string`

Defined in: [types/base.ts:76](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L76)

***

### orderBy?

> `optional` **orderBy**: `object`[]

Defined in: [types/base.ts:77](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L77)

#### column

> **column**: `TableColumn`\<`any`\> \| keyof `T`

#### direction

> **direction**: `OrderDirection`

***

### pageSize

> **pageSize**: `number`

Defined in: [types/base.ts:74](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/types/base.ts#L74)
