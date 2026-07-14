# Portable identifier version 1 fixtures

These draft language-neutral fixtures accompany RFC 0002.

Success entries contain an `id`, a `mode` (`simple` or `qualified`), the exact
`value`, and the expected `segments`. Rejection entries contain exactly one of
`value` or `generator` and the required stable `error` code.

Generators expand as follows:

- `repeat-string`: concatenates `count` copies of `value`;
- `qualified-segments`: joins `count` copies of `segment` with `.`.

Fixture consumers must preserve accepted strings exactly. They must not trim,
case-fold, normalize, or reinterpret qualified identifiers as SQL names.
