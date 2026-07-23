# RFC 0002: Portable logical identifiers

- Status: Proposed
- Version: identifier extension 1

## Summary

Portable Hypequery artifacts need stable names for projects, datasets, queries,
metrics, dimensions, measures, filters, parameters, and relationships. These
names must have the same interpretation in TypeScript, Python, Serve, and Cloud
and must not depend on SQL dialect quoting or Unicode normalization.

This RFC defines one simple identifier grammar and a qualified form composed of
identifier segments separated by `.`.

## Simple identifiers

A version 1 identifier MUST:

- be a JSON string;
- contain between 1 and 128 UTF-8 bytes;
- match `^[A-Za-z_][A-Za-z0-9_]*$`;
- be compared byte-for-byte and case-sensitively;
- not begin with `__hypequery`, using an ASCII case-insensitive comparison.

Implementations MUST preserve the original spelling. They MUST NOT trim,
case-fold, percent-decode, or apply Unicode normalization. Version 1 is ASCII
only, so visually equivalent Unicode spellings are rejected rather than
normalized.

The `__hypequery` prefix is reserved for protocol-defined names. A future core
version may define such names; applications cannot claim them in version 1.

## Qualified identifiers

A qualified identifier is between 1 and 8 simple identifier segments joined by
one literal `.` byte. Its complete UTF-8 representation MUST NOT exceed 512
bytes. Empty segments, leading or trailing dots, repeated dots, and alternate
separator encodings are invalid.

Examples:

```text
orders
orders.customer
orders.customer.country
```

Qualification expresses logical containment or traversal only. It is not a SQL
identifier, table path, filename, URL, or package export. Product adapters own
translation into those domains.

## Limits

| Limit | Maximum |
| --- | ---: |
| UTF-8 bytes in one segment | 128 |
| Segments in one qualified identifier | 8 |
| UTF-8 bytes in one qualified identifier | 512 |

Products may impose lower limits but cannot reinterpret accepted version 1
identifiers.

## Stable failure codes

- `HQ_IDENTIFIER_TYPE`
- `HQ_IDENTIFIER_EMPTY`
- `HQ_IDENTIFIER_TOO_LONG`
- `HQ_IDENTIFIER_INVALID_FORMAT`
- `HQ_IDENTIFIER_RESERVED`
- `HQ_IDENTIFIER_TOO_MANY_SEGMENTS`

Errors and diagnostics MUST NOT include the rejected identifier unless the
calling product explicitly chooses a safe redacted presentation.

## Security considerations

- ASCII-only names avoid confusable and normalization disagreements at the
  portable artifact boundary.
- The reserved namespace prevents user data from impersonating future protocol
  fields.
- Parsers validate limits before allocating derived structures.
- SQL quoting and filesystem sanitization remain mandatory in their respective
  adapters; passing this grammar does not make a name safe for another domain.

## Compatibility

Changing the grammar, comparison rules, reserved namespace, or limits requires
a new identifier extension or core protocol version. Package SemVer does not
select this version.
