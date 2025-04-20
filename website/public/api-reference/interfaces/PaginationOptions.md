[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / PaginationOptions

# Interface: PaginationOptions\<T\>

Defined in: [types/base.ts:73](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L73)

## Type Parameters

### T

`T`

## Properties

### after?

> `optional` **after**: `string`

Defined in: [types/base.ts:75](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L75)

***

### before?

> `optional` **before**: `string`

Defined in: [types/base.ts:76](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L76)

***

### orderBy?

> `optional` **orderBy**: `object`[]

Defined in: [types/base.ts:77](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L77)

#### column

> **column**: `TableColumn`\<`any`\> \| keyof `T`

#### direction

> **direction**: `OrderDirection`

***

### pageSize

> **pageSize**: `number`

Defined in: [types/base.ts:74](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L74)
