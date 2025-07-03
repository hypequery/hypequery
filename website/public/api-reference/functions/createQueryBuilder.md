[**hypequery ClickHouse API**](../README.md)

***

[hypequery ClickHouse API](../globals.md) / createQueryBuilder

# Function: createQueryBuilder()

> **createQueryBuilder**\<`Schema`\>(`config`): `object`

Defined in: [core/query-builder.ts:620](https://github.com/hypequery/hypequery/blob/64a7970b0d65bd3e69a2e7876f19dbfe29817833/packages/clickhouse/src/core/query-builder.ts#L620)

## Type Parameters

### Schema

`Schema` *extends* \{ \[K in string \| number \| symbol\]: (columnName: string) =\> ClickHouseType \}

## Parameters

### config

#### application?

`string`

#### clickhouse_settings?

`ClickHouseSettings`

#### compression?

\{ `request`: `boolean`; `response`: `boolean`; \}

#### compression.request?

`boolean`

#### compression.response?

`boolean`

#### database?

`string`

#### host

`string`

#### http_headers?

`Record`\<`string`, `string`\>

#### keep_alive?

\{ `enabled`: `boolean`; \}

#### keep_alive.enabled

`boolean`

#### log?

`any`

#### password?

`string`

#### request_timeout?

`number`

#### username?

`string`

## Returns

`object`

### table()

#### Type Parameters

##### TableName

`TableName` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### tableName

`TableName`

#### Returns

`QueryBuilder`\<`Schema`, `Schema`\[`TableName`\], `false`, \{\}\>
