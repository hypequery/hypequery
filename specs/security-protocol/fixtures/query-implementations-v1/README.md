# Query implementation extension 1 fixtures

`success.json` contains trusted SQL expressions and all three closed named-query
implementation kinds. `rejections.json` maps invalid artifacts to stable RFC
0005 failure codes. Generator entries create values that JSON cannot represent
concisely or safely.

These fixtures validate artifact structure only. They do not assert that SQL is
valid ClickHouse SQL or authorize it for execution; the trusted ClickHouse
adapter performs those checks.

## Generated rejection semantics

Rejection entries carry a `surface` (`sql-expression` or `implementation`)
selecting the validated artifact kind, exactly one of `value` or
`generator`, and the required stable `error` code. Generator types expand as
follows (RFC 0012):

- `parameters`: a compiled SQL implementation
  `{ "kind": "compiled-sql", "dialect": "clickhouse", "operation":
  "select", "statement": "SELECT 1", "parameters": [...], "readSources":
  [], "tenant": { "kind": "not-required" } }` whose parameters are `count`
  entries `{ "name": "param<i>", "source": { "kind": "input", "path":
  "param<i>" }, "clickHouseType": "String" }` for `i` from 0 to
  `count - 1`;
- `sql-expression`: `{ "kind": "sql-expression", "dialect": "clickhouse",
  "sql": ..., "output": { "kind": "string" }, "dependencies": [] }` with a
  `sql` of `bytes` repetitions of `a`;
- `unsafe-accessor`: an object with `kind` served by an enumerable computed
  accessor returning `"semantic-plan"` instead of a plain data property,
  and no other properties. Host-model conditional (RFC 0012):
  implementations whose input model cannot express computed accessors skip
  this case.
