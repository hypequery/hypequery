# Portable expression fixtures, version 1

These fixtures accompany RFC 0003. `success.json` exercises every closed
operator registry and both semantic query envelopes. `rejections.json` covers
every stable failure code; generator entries describe inputs that are awkward
or unsafe to encode directly as JSON.

## Generated rejection semantics

Rejection entries carry exactly one of `value` or `generator`, a `mode`
(`expression` or `query`) selecting the validated surface, and the required
stable `error` code. Generator types expand as follows (RFC 0012), where
`literal` denotes `{ "kind": "literal", "value": false }`:

- `nested-not`: wraps `literal` in
  `{ "kind": "logical", "operator": "not", "operand": ... }` `depth` times;
- `logical-operands`: one
  `{ "kind": "logical", "operator": "and", "operands": [...] }` node whose
  operands are `count` copies of `literal`;
- `logical-tree`: one `and` node whose operands are 10 `and` nodes, each
  with 100 copies of `literal` as operands (1011 nodes total);
- `unsafe-accessor`: `{ "kind": "reference" }` with `name` served by an
  enumerable computed accessor returning `"orders"` instead of a plain data
  property. Host-model conditional (RFC 0012): implementations whose input
  model cannot express computed accessors skip this case.
