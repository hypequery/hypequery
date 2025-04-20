[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / ClickHouseConnection

# Class: ClickHouseConnection

Defined in: [core/connection.ts:111](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/connection.ts#L111)

The main entry point for connecting to a ClickHouse database.
Provides static methods to initialize the connection and retrieve the client.

## Example

```typescript
// Initialize the connection
ClickHouseConnection.initialize({
  host: 'http://localhost:8123',
  username: 'default',
  password: 'password',
  database: 'my_database'
});

// Get the client to execute queries directly
const client = ClickHouseConnection.getClient();
const result = await client.query({
  query: 'SELECT * FROM my_table',
  format: 'JSONEachRow'
});
```

## Constructors

### Constructor

> **new ClickHouseConnection**(): `ClickHouseConnection`

#### Returns

`ClickHouseConnection`

## Methods

### getClient()

> `static` **getClient**(): `WebClickHouseClient`

Defined in: [core/connection.ts:170](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/connection.ts#L170)

Retrieves the ClickHouse client instance for direct query execution.

#### Returns

`WebClickHouseClient`

The ClickHouse client instance

#### Throws

Will throw an error if the connection has not been initialized

#### Example

```typescript
const client = ClickHouseConnection.getClient();
const result = await client.query({
  query: 'SELECT * FROM my_table',
  format: 'JSONEachRow'
});
```

***

### initialize()

> `static` **initialize**(`config`): *typeof* `ClickHouseConnection`

Defined in: [core/connection.ts:133](https://github.com/hypequery/hypequery/blob/ae4f4eab4c2fdf4856fe5bd7c69fb922444337a1/packages/clickhouse/src/core/connection.ts#L133)

Initializes the ClickHouse connection with the provided configuration.
This method must be called before any queries can be executed.

#### Parameters

##### config

`ClickHouseConnectionOptions`

The connection configuration options

#### Returns

*typeof* `ClickHouseConnection`

The ClickHouseConnection class for method chaining

#### Throws

Will throw an error if the connection cannot be established

#### Example

```typescript
// For a local ClickHouse instance
ClickHouseConnection.initialize({
  host: 'http://localhost:8123',
  username: 'default',
  password: 'password',
  database: 'my_database'
});
```
