---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0004 and freeze portable query schema extension version 1.

The accepted text pins the constraint rules both implementations already
enforce: an `object` declaring all three of `properties`, `required`, and
`unknownProperties`; non-empty `enum.values`; at least two `union.variants`;
and the numeric bound rules covering inclusive-with-exclusive, reversed, and
unsatisfiable ranges.

It also specifies defaults. `default`, `literal.value`, and `enum.values` are
canonical values, so composites are tagged and a raw JSON array or object is
not a default. A declared `default` must be a value its own schema accepts,
checked when the schema is validated rather than when a request arrives, so a
contract no caller could satisfy fails at build time. `void` declares no
`default` field at all, making a supplied one an unknown field rather than an
invalid value.

The shared `query-schemas-v1` corpus grows from 13 to 24 rejection cases,
pinning each of those rules across languages.
