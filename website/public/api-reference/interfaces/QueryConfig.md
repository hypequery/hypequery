[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / QueryConfig

# Interface: QueryConfig\<T, Schema\>

Defined in: [types/base.ts:4](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L4)

## Type Parameters

### T

`T`

### Schema

`Schema`

## Properties

### ctes?

> `optional` **ctes**: `string`[]

Defined in: [types/base.ts:18](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L18)

***

### distinct?

> `optional` **distinct**: `boolean`

Defined in: [types/base.ts:11](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L11)

***

### groupBy?

> `optional` **groupBy**: `string`[]

Defined in: [types/base.ts:7](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L7)

***

### having?

> `optional` **having**: `string`[]

Defined in: [types/base.ts:8](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L8)

***

### joins?

> `optional` **joins**: `JoinClause`[]

Defined in: [types/base.ts:16](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L16)

***

### limit?

> `optional` **limit**: `number`

Defined in: [types/base.ts:9](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L9)

***

### offset?

> `optional` **offset**: `number`

Defined in: [types/base.ts:10](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L10)

***

### orderBy?

> `optional` **orderBy**: `object`[]

Defined in: [types/base.ts:12](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L12)

#### column

> **column**: keyof `T` \| `TableColumn`\<`Schema`\>

#### direction

> **direction**: `OrderDirection`

***

### parameters?

> `optional` **parameters**: `any`[]

Defined in: [types/base.ts:17](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L17)

***

### select?

> `optional` **select**: (`string` \| keyof `T`)[]

Defined in: [types/base.ts:5](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L5)

***

### settings?

> `optional` **settings**: `string`

Defined in: [types/base.ts:20](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L20)

***

### unionQueries?

> `optional` **unionQueries**: `string`[]

Defined in: [types/base.ts:19](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L19)

***

### where?

> `optional` **where**: `WhereCondition`[]

Defined in: [types/base.ts:6](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/types/base.ts#L6)
