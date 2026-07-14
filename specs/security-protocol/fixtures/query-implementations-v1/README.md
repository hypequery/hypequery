# Query implementation extension 1 fixtures

`success.json` contains trusted SQL expressions and all three closed named-query
implementation kinds. `rejections.json` maps invalid artifacts to stable RFC
0005 failure codes. Generator entries create values that JSON cannot represent
concisely or safely.

These fixtures validate artifact structure only. They do not assert that SQL is
valid ClickHouse SQL or authorize it for execution; the trusted ClickHouse
adapter performs those checks.
