# Portable expression v1 fixtures

This family accompanies accepted RFC 0003 and covers the closed semantic expression registry plus metric and dataset query envelopes.

`success.json` exercises accepted expressions and queries. `rejections.json` pins every stable failure code, including generated depth, width, node-count, and unsafe-accessor cases. Together they pin the exact protocol boundaries: depth 16/17, 1,000/1,001 nodes, and 100/101 collection items.

Each case contains exactly one literal `value` or deterministic `generator`. Each rejection also selects the `expression` or `query` validation surface.

Generators have these language-neutral meanings:

- `nested-not` wraps the literal expression `{ "kind": "literal", "value": false }` in exactly `depth` logical `not` nodes.
- `logical-operands` creates one logical `and` node containing `count` distinct copies of that literal expression.
- `logical-tree` creates a logical `and` root with ten logical `and` groups. The first nine groups contain 100 distinct literal expressions and the tenth contains `lastGroupItems`. The resulting expression has exactly `911 + lastGroupItems` nodes.
- `unsafe-accessor` is host-model conditional under RFC 0012 and exposes a reference's `name` through an accessor rather than a data property.
