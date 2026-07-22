# Portable query schema fixtures, version 1

These fixtures accompany RFC 0004. Success fixtures cover every schema kind
and every currently portable Serve/Zod feature. Rejection fixtures cover every
stable failure code; generators describe oversized or unsafe inputs that
cannot be represented directly in JSON.

## Generated rejection semantics

Rejection entries carry exactly one of `value` or `generator` and the
required stable `error` code. Generator types expand as follows (RFC 0012):

- `nested-array`: wraps `{ "kind": "any" }` in
  `{ "kind": "array", "items": ... }` `depth` times;
- `union-tree`: one `{ "kind": "union", "variants": [...] }` node whose
  variants are 10 union nodes, each with 100 `{ "kind": "any" }` variants
  (1011 nodes total);
- `enum-values`: `{ "kind": "enum", "values": [...] }` with `count` values
  `v0` through `v<count - 1>`;
- `description`: `{ "kind": "string", "description": ... }` with a
  description of `bytes` repetitions of `a`;
- `unsafe-accessor`: an object with `kind` served by an enumerable computed
  accessor returning `"string"` instead of a plain data property, and no
  other properties. Host-model conditional (RFC 0012): implementations
  whose input model cannot express computed accessors skip this case.
