[**HypeQuery ClickHouse API**](../README.md)

***

[HypeQuery ClickHouse API](../globals.md) / CrossFilter

# Class: CrossFilter\<Schema, TableName\>

Defined in: [core/cross-filter.ts:44](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L44)

A type-safe filter builder supporting both simple conditions and complex nested groups.

## Type Parameters

### Schema

`Schema` *extends* `object` = `any`

The full database schema type

### TableName

`TableName` *extends* keyof `Schema` = `Extract`\<keyof `Schema`, `string`\>

The specific table being filtered

## Constructors

### Constructor

> **new CrossFilter**\<`Schema`, `TableName`\>(`schema`?): `CrossFilter`\<`Schema`, `TableName`\>

Defined in: [core/cross-filter.ts:52](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L52)

#### Parameters

##### schema?

`Schema`

#### Returns

`CrossFilter`\<`Schema`, `TableName`\>

## Methods

### add()

> **add**\<`ColumnName`, `Op`\>(`condition`): `this`

Defined in: [core/cross-filter.ts:60](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L60)

Adds a single filter condition to the root group with an implicit AND conjunction.
Performs type-safe validation if a schema is provided.

#### Type Parameters

##### ColumnName

`ColumnName` *extends* `string`

##### Op

`Op` *extends* keyof `OperatorValueMap`\<`any`\>

#### Parameters

##### condition

`FilterConditionInput`\<`OperatorValueMap`\<`InferClickHouseType`\<`Schema`\[`TableName`\]\[`ColumnName`\]\>\>\[`Op`\], `Schema`, `Schema`\[`TableName`\]\>

#### Returns

`this`

***

### addComparisonPeriod()

> **addComparisonPeriod**\<`K`\>(`column`, `currentRange`): `this`

Defined in: [core/cross-filter.ts:286](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L286)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### column

`K` *extends* keyof `Schema`\[`TableName`\] ? `Schema`\[`TableName`\]\[`K`\<`K`\>\] *extends* `"Date"` \| `"DateTime"` ? `K`\<`K`\> : `never` : `never`

##### currentRange

\[`Date`, `Date`\]

#### Returns

`this`

***

### addDateRange()

> **addDateRange**\<`K`\>(`column`, `range`): `this`

Defined in: [core/cross-filter.ts:216](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L216)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### column

`K` *extends* keyof `Schema`\[`TableName`\] ? `Schema`\[`TableName`\]\[`K`\<`K`\>\] *extends* `"Date"` \| `"DateTime"` ? `K`\<`K`\> : `never` : `never`

##### range

`DateRangeType`

#### Returns

`this`

***

### addGroup()

> **addGroup**(`groupConditions`, `operator`): `this`

Defined in: [core/cross-filter.ts:113](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L113)

Adds a nested group of filter conditions to the root group using the specified logical operator.

#### Parameters

##### groupConditions

(`FilterGroup`\<`Schema`, `Schema`\[`TableName`\]\> \| `FilterConditionInput`\<`any`, `Schema`, `Schema`\[`TableName`\]\>)[]

Array of filter conditions or nested groups to be grouped together.

##### operator

Logical operator ('AND' or 'OR') to combine the conditions in the group.

`"AND"` | `"OR"`

#### Returns

`this`

***

### addMultiple()

> **addMultiple**(`conditions`): `this`

Defined in: [core/cross-filter.ts:98](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L98)

Adds multiple filter conditions to the root group.

#### Parameters

##### conditions

`FilterConditionInput`\<`any`, `Schema`, `Schema`\[`TableName`\]\>[]

#### Returns

`this`

***

### addYearOverYear()

> **addYearOverYear**\<`K`\>(`column`, `currentRange`): `this`

Defined in: [core/cross-filter.ts:301](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L301)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### column

`K` *extends* keyof `Schema`\[`TableName`\] ? `Schema`\[`TableName`\]\[`K`\<`K`\>\] *extends* `"Date"` \| `"DateTime"` ? `K`\<`K`\> : `never` : `never`

##### currentRange

\[`Date`, `Date`\]

#### Returns

`this`

***

### getConditions()

> **getConditions**(): `FilterGroup`\<`Schema`, `Schema`\[`TableName`\]\>

Defined in: [core/cross-filter.ts:133](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L133)

Returns the current filter tree representing all conditions and groups.

#### Returns

`FilterGroup`\<`Schema`, `Schema`\[`TableName`\]\>

***

### lastNDays()

> **lastNDays**\<`K`\>(`column`, `days`): `this`

Defined in: [core/cross-filter.ts:271](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L271)

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### column

`K` *extends* keyof `Schema`\[`TableName`\] ? `Schema`\[`TableName`\]\[`K`\<`K`\>\] *extends* `"Date"` \| `"DateTime"` ? `K`\<`K`\> : `never` : `never`

##### days

`number`

#### Returns

`this`

***

### topN()

> **topN**\<`K`\>(`valueColumn`, `n`, `orderBy`): `this`

Defined in: [core/cross-filter.ts:323](https://github.com/hypequery/hypequery/blob/3a853586c0085fc2ab37dc87d6e763ba6887182a/packages/clickhouse/src/core/cross-filter.ts#L323)

Creates a filter for top N records by a value column

#### Type Parameters

##### K

`K` *extends* `string` \| `number` \| `symbol`

#### Parameters

##### valueColumn

`K`

The column to filter and order by

##### n

`number`

Number of records to return

##### orderBy

Sort direction, defaults to 'desc'

`"desc"` | `"asc"`

#### Returns

`this`
