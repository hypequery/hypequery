[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / JoinRelationships

# Class: JoinRelationships\<Schema\>

Defined in: [core/join-relationships.ts:18](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L18)

## Type Parameters

### Schema

`Schema` *extends* `object`

## Constructors

### Constructor

> **new JoinRelationships**\<`Schema`\>(): `JoinRelationships`\<`Schema`\>

#### Returns

`JoinRelationships`\<`Schema`\>

## Methods

### clear()

> **clear**(): `void`

Defined in: [core/join-relationships.ts:68](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L68)

Clear all join relationships

#### Returns

`void`

***

### define()

> **define**(`name`, `path`): `void`

Defined in: [core/join-relationships.ts:24](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L24)

Define a single join relationship

#### Parameters

##### name

`string`

##### path

[`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\>

#### Returns

`void`

***

### defineChain()

> **defineChain**(`name`, `paths`): `void`

Defined in: [core/join-relationships.ts:34](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L34)

Define a chain of join relationships

#### Parameters

##### name

`string`

##### paths

[`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\>[]

#### Returns

`void`

***

### get()

> **get**(`name`): `undefined` \| [`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\> \| [`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\>[]

Defined in: [core/join-relationships.ts:47](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L47)

Get a join relationship by name

#### Parameters

##### name

`string`

#### Returns

`undefined` \| [`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\> \| [`JoinPath`](../interfaces/JoinPath.md)\<`Schema`\>[]

***

### getDefinedRelationships()

> **getDefinedRelationships**(): `string`[]

Defined in: [core/join-relationships.ts:75](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L75)

Get all defined relationship names

#### Returns

`string`[]

***

### has()

> **has**(`name`): `boolean`

Defined in: [core/join-relationships.ts:54](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L54)

Check if a join relationship exists

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### remove()

> **remove**(`name`): `boolean`

Defined in: [core/join-relationships.ts:61](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/join-relationships.ts#L61)

Remove a join relationship

#### Parameters

##### name

`string`

#### Returns

`boolean`
