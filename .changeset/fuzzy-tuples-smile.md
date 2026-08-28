---
"@hypequery/clickhouse": minor
"@hypequery/cli": minor
---

Generate valid TypeScript for pretty-printed ClickHouse types and infer named
`Tuple(...)` values as objects in generated records, query results, and inserts.

`DESCRIBE TABLE` returns wide types pretty-printed across several lines. Those
were embedded in single-quoted string literals, so any table with a multi-line
type produced a schema file that did not compile. Type literals are now
serialized with `JSON.stringify`, which escapes newlines and quotes together.

Named tuples are also inferred structurally instead of positionally, matching
what ClickHouse actually returns over `JSONEachRow`. For a column typed
`Array(Tuple(installed_version String, path Nullable(String)))`, the record
interface the CLI writes changes from:

```ts
'versions': Array<[string, string]>;                              // before
'versions': Array<{ installed_version: string; path: string | null }>;  // after
```

**Potentially breaking for `@hypequery/clickhouse`.** `InferClickHouseType`
previously resolved a named tuple to a positional tuple whose elements were
`never`. Positional reads compiled, because `never` is assignable to anything,
but carried no type information. They are now property accesses:

```ts
// before — compiled, inferred `never`
const version = row.versions[0][0];

// after
const version = row.versions[0].installed_version;
```

`InsertValue` changes the same way, but nothing that typechecked before stops
typechecking: its named-tuple elements were also `never`, so no value could
satisfy them. Named-tuple columns previously could not be inserted without a
cast, and can now be written as objects:

```ts
db.insert('packages').values({
  versions: [{ installed_version: '1.0.0', path: null }],
});
```

Object inference assumes the server serializes named tuples as JSON objects
(`output_format_json_named_tuples_as_objects`, on by default). Connections that
disable it, or that pin `compatibility` to a release predating the default,
still receive arrays.

Regenerating with the CLI is what surfaces the new record types; existing
generated files keep their current shape until you re-run `hypequery generate`.
